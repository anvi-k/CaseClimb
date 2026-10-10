"""Deployment guardrails for the independently cancellable streaming runtime."""

import json
import re
import sys
from pathlib import Path

import pytest

from infra import deploy


ROOT = Path(__file__).resolve().parents[1]


def template():
    return json.loads((ROOT / "infra" / "stack.json").read_text())


def references(value):
    """Include intrinsic and explicit dependencies, including embedded Sub ARNs."""
    found = set()
    if isinstance(value, dict):
        if "Ref" in value:
            found.add(value["Ref"])
        if "Fn::GetAtt" in value:
            target = value["Fn::GetAtt"]
            found.add(target[0] if isinstance(target, list) else target.split(".")[0])
        if "Fn::Sub" in value:
            sub = value["Fn::Sub"]
            if isinstance(sub, str):
                found.update(match.split(".")[0] for match in re.findall(r"\$\{([^!][^}]*)\}", sub))
            else:
                found.update(match.split(".")[0] for match in re.findall(r"\$\{([^!][^}]*)\}", sub[0]) if match not in sub[1])
        depends = value.get("DependsOn", [])
        found.update([depends] if isinstance(depends, str) else depends)
        for item in value.values():
            found.update(references(item))
    elif isinstance(value, list):
        for item in value:
            found.update(references(item))
    return found


def test_cloudformation_dependencies_have_no_cycles():
    resources = template()["Resources"]
    graph = {name: references(resource) & resources.keys() for name, resource in resources.items()}
    resolved, visiting = set(), set()

    def visit(name):
        assert name not in visiting, f"CloudFormation dependency cycle through {name}"
        if name in resolved:
            return
        visiting.add(name)
        for dependency in graph[name]:
            visit(dependency)
        visiting.remove(name)
        resolved.add(name)

    for name in graph:
        visit(name)


def test_stream_callbacks_and_dispatch_have_resource_boundaries():
    resources = template()["Resources"]
    statements = resources["StreamRole"]["Properties"]["Policies"][0]["PolicyDocument"]["Statement"]
    actions = {statement["Action"]: statement["Resource"] for statement in statements if isinstance(statement.get("Action"), str)}
    callback = actions["execute-api:ManageConnections"]["Fn::Sub"]
    assert callback.endswith("${StreamApi}/stream/*/@connections/*")
    assert ":${StreamApi}" in callback
    invoke = actions["lambda:InvokeFunction"]["Fn::Sub"]
    assert invoke.endswith("function:${AWS::StackName}-stream")
    assert "*" not in invoke
    assert "StreamFunction" not in references(resources["StreamRole"])
    assert not any(statement.get("Resource") == "*" for statement in statements)


def test_control_and_stream_runtime_capacity_and_retry_are_separate():
    resources = template()["Resources"]
    assert resources["ApiFunction"]["Properties"]["ReservedConcurrentExecutions"] == 10
    worker = resources["StreamFunction"]["Properties"]
    assert worker["ReservedConcurrentExecutions"] == 5
    assert worker["Timeout"] >= 75
    assert worker["Code"] == resources["ApiFunction"]["Properties"]["Code"]
    async_config = resources["StreamAsyncConfiguration"]["Properties"]
    assert async_config["MaximumRetryAttempts"] == 0
    assert async_config["MaximumEventAgeInSeconds"] == 60
    assert async_config["Qualifier"] == "$LATEST"
    stage = resources["StreamStage"]["Properties"]
    assert stage["DefaultRouteSettings"]["DataTraceEnabled"] is False
    assert "AccessLogSettings" not in stage


@pytest.mark.parametrize("budget", ["0", "-1", "3601"])
def test_invalid_stt_budget_is_rejected_before_aws_access(monkeypatch, budget):
    monkeypatch.setattr(sys, "argv", ["deploy.py", "--profile", "synthetic", "--expected-account", "123456789012", "--stt-second-budget", budget])

    def forbidden(*args):
        pytest.fail("Invalid budget reached AWS credential export")

    monkeypatch.setattr(deploy, "session", forbidden)
    with pytest.raises(SystemExit) as error:
        deploy.main()
    assert error.value.code == 2


def test_stt_enable_without_key_cannot_write_configuration(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["deploy.py", "--profile", "synthetic", "--expected-account", "123456789012", "--enable-stt"])

    class Sts:
        def get_caller_identity(self):
            return {"Account": "123456789012"}

    class Aws:
        def client(self, name):
            assert name == "sts", "Missing provider key reached deployment services"
            return Sts()

    monkeypatch.setattr(deploy, "session", lambda *args: Aws())
    monkeypatch.setattr(deploy, "read_env", lambda path: {})
    monkeypatch.setattr(deploy, "private_write", lambda *args: pytest.fail("Missing provider key changed private configuration"))
    with pytest.raises(RuntimeError, match="requires an explicitly configured ElevenLabs key"):
        deploy.main()
