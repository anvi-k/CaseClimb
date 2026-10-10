"""API Gateway WebSocket dispatcher and asynchronously claimed stream worker."""

import json
import os

from fastapi import HTTPException

from .streaming import StreamService

_service = None


def service():
    global _service
    if _service is None:
        import boto3
        from botocore.config import Config
        from .app import app
        management = boto3.client("apigatewaymanagementapi", endpoint_url=os.environ["CASECLIMB_STREAM_MANAGEMENT_URL"], config=Config(connect_timeout=2, read_timeout=3, retries={"max_attempts": 0}))
        worker = boto3.client("lambda", config=Config(connect_timeout=2, read_timeout=3, retries={"max_attempts": 0}))

        def send(connection_id, frame):
            management.post_to_connection(ConnectionId=connection_id, Data=json.dumps(frame, ensure_ascii=False).encode())

        def dispatch(payload):
            response = worker.invoke(FunctionName=os.environ["CASECLIMB_STREAM_FUNCTION_NAME"], InvocationType="Event", Payload=json.dumps(payload).encode())
            if response.get("StatusCode") != 202:
                raise RuntimeError("Worker dispatch was not acknowledged")

        _service = StreamService(app, send, dispatch)
    return _service


def handler(event, context):
    runtime = service()
    if event.get("caseclimb_stream_worker") is True:
        remaining = context.get_remaining_time_in_millis() / 1000 - 5 if context and hasattr(context, "get_remaining_time_in_millis") else 55
        runtime.worker(event.get("connection_id", ""), event.get("job_id", ""), seconds=min(55, remaining))
        return {"statusCode": 200}
    request = event.get("requestContext", {})
    connection_id, route = request.get("connectionId"), request.get("routeKey")
    if not connection_id or route not in {"$connect", "$disconnect", "$default"}:
        return {"statusCode": 400, "body": "Invalid streaming request."}
    try:
        if route == "$connect":
            headers = {name.lower(): value for name, value in (event.get("headers") or {}).items()}
            query = event.get("queryStringParameters") or {}
            runtime.connect(connection_id, query.get("ticket"), headers.get("origin", ""))
        elif route == "$disconnect":
            runtime.disconnect(connection_id)
        else:
            raw = event.get("body", "")
            if not isinstance(raw, str) or event.get("isBase64Encoded") or len(raw.encode()) > 8192:
                raise HTTPException(422, "A bounded JSON streaming message is required.")
            message = json.loads(raw)
            runtime.dispatch(connection_id, message)
        return {"statusCode": 200}
    except Exception as error:
        status = error.status_code if isinstance(error, HTTPException) else 422 if isinstance(error, (ValueError, TypeError)) else 503
        if route == "$default":
            try:
                message = json.loads(event.get("body", "{}"))
                request_id = message.get("request_id") if isinstance(message, dict) else None
                if not isinstance(request_id, str) or len(request_id) > 100:
                    request_id = None
                runtime._connection(connection_id)
                runtime._emit(connection_id, {"type": "stream.error", "request_id": request_id, "code": "request_rejected", "message": "Streaming request was rejected. Read the encounter ledger before retrying explicitly."})
            except Exception:
                pass
        return {"statusCode": status, "body": "Streaming request was rejected."}
