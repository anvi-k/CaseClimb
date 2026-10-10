"""Revision-based stores prevent cross-request overwrites and duplicated turns."""

import fcntl
import json
import os
import tempfile
from pathlib import Path
from typing import Any


class Conflict(Exception):
    pass


class FileStore:
    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock_path = self.path.with_suffix(".lock")

    def _read(self):
        return json.loads(self.path.read_text()) if self.path.exists() else {}

    def get(self, key: str) -> dict | None:
        with self.lock_path.open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_SH)
            return self._read().get(key)

    def put(self, key: str, payload: dict, expected_revision: int | None, expires_at: int | None = None):
        with self.lock_path.open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            items = self._read()
            prior = items.get(key)
            if (prior is None and expected_revision is not None) or (prior and prior["revision"] != expected_revision):
                raise Conflict()
            record = {"revision": (expected_revision or 0) + 1, "payload": payload}
            if expires_at is not None:
                record["expires_at"] = expires_at
            items[key] = record
            fd, name = tempfile.mkstemp(dir=self.path.parent, prefix=".caseclimb-")
            try:
                os.fchmod(fd, 0o600)
                with os.fdopen(fd, "w") as stream:
                    json.dump(items, stream, ensure_ascii=False)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(name, self.path)
            finally:
                if os.path.exists(name):
                    os.unlink(name)
            return record

    def list(self, prefix: str):
        with self.lock_path.open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_SH)
            return [v for k, v in self._read().items() if k.startswith(prefix)]


class DynamoStore:
    """Table hash key pk:String; revision:Number, payload:String, expires_at:Number TTL."""

    def __init__(self, table_name: str, resource: Any = None):
        if resource is None:
            import boto3
            resource = boto3.resource("dynamodb")
        self.table = resource.Table(table_name)

    def get(self, key: str):
        item = self.table.get_item(Key={"pk": key}, ConsistentRead=True).get("Item")
        if not item:
            return None
        return {"revision": int(item["revision"]), "payload": json.loads(item["payload"])}

    def put(self, key: str, payload: dict, expected_revision: int | None, expires_at: int | None = None):
        from botocore.exceptions import ClientError
        item = {"pk": key, "revision": (expected_revision or 0) + 1, "payload": json.dumps(payload, ensure_ascii=False)}
        if expires_at is not None:
            item["expires_at"] = expires_at
        args = {"Item": item, "ConditionExpression": "attribute_not_exists(pk)"}
        if expected_revision is not None:
            args.update(ConditionExpression="#r = :r", ExpressionAttributeNames={"#r": "revision"}, ExpressionAttributeValues={":r": expected_revision})
        try:
            self.table.put_item(**args)
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise Conflict() from exc
            raise
        return {"revision": item["revision"], "payload": payload}

    def list(self, prefix: str):
        args = {"FilterExpression": "begins_with(pk, :p)", "ExpressionAttributeValues": {":p": prefix}, "ConsistentRead": True}
        result = []
        while True:
            response = self.table.scan(**args)
            result.extend({"revision": int(i["revision"]), "payload": json.loads(i["payload"])} for i in response.get("Items", []))
            if not response.get("LastEvaluatedKey"):
                return result
            args["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def configured_store():
    mode = os.getenv("CASECLIMB_STORE", "file")
    if mode == "dynamodb":
        table = os.getenv("CASECLIMB_TABLE_NAME")
        if not table:
            raise RuntimeError("CASECLIMB_TABLE_NAME is required for DynamoDB")
        return DynamoStore(table)
    if mode != "file":
        raise RuntimeError("CASECLIMB_STORE must be file or dynamodb")
    return FileStore(os.getenv("CASECLIMB_DATA_FILE", ".private/caseclimb-data.json"))
