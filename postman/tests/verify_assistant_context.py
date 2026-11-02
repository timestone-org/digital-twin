"""真实 HTTP、Postgres 与 Redis 验收；模型供应商使用本地仿真。"""

import argparse
import asyncio
import json
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, TypeAdapter
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from ai_assistant.apps.chat.models import ChatMessage, ChatSession
from ai_assistant.apps.chat.schemas.session import SessionDetailOut, SessionOut
from lib.auth import (
    SignedContext,
    encode_identity,
    encode_permissions,
    sign_context,
)
from llmcore.output.payloads import ContextPayload, DeltaPayload


class RequestRecord(BaseModel):
    """合成模型日志的有界统计，不含原文与身份。"""

    kind: str
    stream: bool
    message_count: int
    input_chars: int
    tool_count: int
    status: int


class ModelStats(BaseModel):
    """模拟端独立记录的请求数。"""

    mode: str
    records: list[RequestRecord]
    chat: int
    summary: int


FRAME_SCHEMA = TypeAdapter(dict[str, object])

SIGNING_SECRET = "dt_validation_signing_secret_32chars_only"
SESSIONS = "/api/v1/assistant/sessions"
REPLY = "已完成真实传输边界验收。"


def _headers() -> dict[str, str]:
    user_id = str(uuid.uuid4())
    role = encode_identity("admin")
    permissions = encode_permissions(
        (
            "assistant:use",
            "dashboard:view",
            "dashboard:edit",
            "dashboard:manage",
        )
    )
    expires = int(time.time()) + 900
    context = SignedContext(
        user_id=user_id,
        role=role,
        permissions_b64=permissions,
        expires_at=expires,
    )
    return {
        "X-Auth-User-Id": user_id,
        "X-Auth-Username": encode_identity("隔离验收"),
        "X-Auth-Role": role,
        "X-Auth-Permissions": permissions,
        "X-Auth-Exp": str(expires),
        "X-Auth-Sig": sign_context(SIGNING_SECRET, context),
    }


def _events(response: httpx.Response) -> list[tuple[str, dict[str, object]]]:
    assert response.status_code == 200, response.status_code
    assert response.headers["content-type"].startswith("text/event-stream")
    result: list[tuple[str, dict[str, object]]] = []
    for block in response.text.strip().split("\n\n"):
        name = next(
            line[7:]
            for line in block.splitlines()
            if line.startswith("event: ")
        )
        body = next(
            line[6:] for line in block.splitlines() if line.startswith("data: ")
        )
        result.append((name, FRAME_SCHEMA.validate_json(body)))
    assert not [body for name, body in result if name == "error"], result
    return result


async def _new(client: httpx.AsyncClient) -> str:
    response = await client.post(
        SESSIONS,
        json={"surface_kind": "dashboard-editor", "title": "真实传输验收"},
    )
    assert response.status_code == 201, response.status_code
    return str(SessionOut.model_validate(response.json()["data"]).id)


async def _advance(
    client: httpx.AsyncClient, session_id: str, **payload: object
) -> list[tuple[str, dict[str, object]]]:
    response = await client.post(
        f"{SESSIONS}/{session_id}:advance",
        json={"surface_kind": "dashboard-editor", **payload},
    )
    return _events(response)


async def _seed(
    maker: async_sessionmaker[AsyncSession], session_id: str, long_count: int
) -> list[str]:
    texts = [
        "保留 T001 温度点位。" + "早前必须保留的事实与结论。" * long_count,
        "已读取设备事实并核验。"
        + ("早前已核验的助手过程。" * 2400 if long_count > 700 else ""),
        "继续完成任务。",
        "等待用户下一步要求。",
    ]
    async with maker() as session:
        for seq, text in enumerate(texts, start=1):
            session.add(
                ChatMessage(
                    session_id=uuid.UUID(session_id),
                    seq=seq,
                    role="user" if seq % 2 else "assistant",
                    content_json={"text": text},
                )
            )
        await session.commit()
    return texts


async def _stats(provider: httpx.AsyncClient) -> ModelStats:
    response = await provider.get("/stats")
    response.raise_for_status()
    return ModelStats.model_validate_json(response.content)


async def _detail(
    client: httpx.AsyncClient, session_id: str
) -> SessionDetailOut:
    response = await client.get(f"{SESSIONS}/{session_id}")
    response.raise_for_status()
    return SessionDetailOut.model_validate(response.json()["data"])


async def _delete_session(client: httpx.AsyncClient, session_id: str) -> None:
    """精确清理本场景创建的会话且不重试；Args: client, session_id。"""
    response = await client.delete(f"{SESSIONS}/{session_id}")
    if response.status_code != 204:
        raise RuntimeError("验收会话清理失败")


async def _summary_case(
    client: httpx.AsyncClient,
    provider: httpx.AsyncClient,
    maker: async_sessionmaker[AsyncSession],
) -> dict[str, object]:
    await provider.post("/control", json={"mode": "normal"})
    session_id = await _new(client)
    try:
        original = await _seed(maker, session_id, 850)
        events = await _advance(
            client, session_id, user_text="当前要求：不要修改用户数据。"
        )
        assert events[-1] == ("turn.done", {"reply": REPLY})
        updates = [
            ContextPayload.model_validate(body)
            for name, body in events
            if name == "context"
        ]
        assert any(body.state == "compressed" for body in updates)
        assert updates[-1].used_tokens == 1520
        assert updates[-1].is_estimated is False
        detail = await _detail(client, session_id)
        assert [
            row.content_json["text"] for row in detail.messages[:4]
        ] == original
        assert len(detail.messages) == 6
        async with maker() as session:
            stored = await session.get(ChatSession, uuid.UUID(session_id))
            assert stored is not None
            assert stored.summary_json is not None
            assert stored.summary_json["through_seq"] > 1
        stats = await _stats(provider)
        assert stats.summary >= 1
        assert stats.chat == 1
        assert any(
            row.kind == "summary" and not row.stream for row in stats.records
        )
        assert any(row.kind == "chat" and row.stream for row in stats.records)
        return {
            "scenario": "automatic_compaction",
            "http_records": [row.model_dump() for row in stats.records],
            "history_messages": 6,
            "usage_tokens": 1520,
        }
    finally:
        await _delete_session(client, session_id)


async def _overflow_case(
    client: httpx.AsyncClient,
    provider: httpx.AsyncClient,
    maker: async_sessionmaker[AsyncSession],
) -> dict[str, object]:
    await provider.post("/control", json={"mode": "overflow-once"})
    session_id = await _new(client)
    try:
        original = await _seed(maker, session_id, 250)
        events = await _advance(client, session_id, user_text="继续当前任务。")
        assert events[-1] == ("turn.done", {"reply": REPLY})
        stats = await _stats(provider)
        chats = [row for row in stats.records if row.kind == "chat"]
        assert [row.status for row in chats] == [400, 200]
        assert chats[1].input_chars < chats[0].input_chars
        deltas = [
            DeltaPayload.model_validate(body).text
            for name, body in events
            if name == "message.delta"
            and DeltaPayload.model_validate(body).channel == "text"
        ]
        assert "".join(deltas) == REPLY
        detail = await _detail(client, session_id)
        assert [
            row.content_json["text"] for row in detail.messages[:4]
        ] == original
        assert len(detail.messages) == 6
        return {
            "scenario": "structured_overflow_recovery",
            "http_records": [row.model_dump() for row in stats.records],
            "reply_copies": 1,
        }
    finally:
        await _delete_session(client, session_id)


async def _receipt_case(
    client: httpx.AsyncClient, provider: httpx.AsyncClient
) -> dict[str, object]:
    await provider.post("/control", json={"mode": "client-tool"})
    session_id = await _new(client)
    try:
        events = await _advance(
            client, session_id, user_text="绑定 T001 点位。"
        )
        assert events[-1][0] == "client_tool.request"
        result = {"call_id": "wire-call-1", "output": {"ok": True}}
        receipt = await client.post(
            f"{SESSIONS}/{session_id}:receipts", json={"tool_results": [result]}
        )
        assert receipt.status_code == 200
        assert (await _stats(provider)).chat == 1
        events = await _advance(client, session_id, tool_results=[result])
        assert events[-1] == ("turn.done", {"reply": REPLY})
        messages = (await _detail(client, session_id)).messages
        replies = [row for row in messages if row.role == "tool"]
        assert len(replies) == 1
        assert replies[0].content_json["tool_call_id"] == "wire-call-1"
        stats = await _stats(provider)
        assert stats.chat == 2
        return {
            "scenario": "receipt_continue",
            "http_records": [row.model_dump() for row in stats.records],
            "stored_receipts": 1,
        }
    finally:
        await _delete_session(client, session_id)


def _is_local_http_url(value: str) -> bool:
    """只接受无身份信息且带显式端口的回环 HTTP；Args: value。"""
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        return False
    return (
        parts.scheme == "http"
        and parts.hostname == "127.0.0.1"
        and port is not None
        and 0 < port <= 65535
        and parts.username is None
        and parts.password is None
    )


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assistant", default="http://127.0.0.1:18086")
    parser.add_argument(
        "--provider", default="http://127.0.0.1:4141/assistant-model"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(tempfile.gettempdir())
        / "dt-assistant-context-result.json",
    )
    args = parser.parse_args()
    if not _is_local_http_url(args.assistant) or not _is_local_http_url(
        args.provider
    ):
        parser.error("验收地址只允许无身份信息且带显式端口的本地 HTTP")
    return args


async def main() -> None:
    if not __debug__:
        raise RuntimeError("验收脚本禁止使用 python -O")
    args = _arguments()
    engine = create_async_engine(
        "postgresql+asyncpg://dt_validation:dt_validation_only@127.0.0.1:55439/dt_ai_validation"
    )
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with httpx.AsyncClient(
            base_url=args.assistant, headers=_headers(), timeout=30
        ) as client:
            ready = await client.get("/api/v1/assistant/ready")
            assert ready.status_code == 200
            async with httpx.AsyncClient(
                base_url=args.provider, timeout=5
            ) as provider:
                results = [
                    await _summary_case(client, provider, maker),
                    await _overflow_case(client, provider, maker),
                    await _receipt_case(client, provider),
                ]
        report = {
            "status": "passed",
            "real": [
                "FastAPI socket HTTP",
                "PostgreSQL",
                "Redis",
                "OpenAiCompatAdapter",
            ],
            "simulated": ["model provider"],
            "scenarios": results,
        }
        await asyncio.to_thread(
            args.output.write_text,
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        )
        sys.stdout.write(
            json.dumps(
                {
                    "status": "passed",
                    "scenarios": len(results),
                    "report": str(args.output),
                }
            )
            + "\n"
        )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
