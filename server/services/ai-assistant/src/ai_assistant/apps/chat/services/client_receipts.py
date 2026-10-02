"""实际客户端回执按既有调用 id 结算；不调用模型或执行工具。"""

import hashlib
import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, cast

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.crud import session_crud
from ai_assistant.apps.chat.models import ChatMessage, ChatStep
from ai_assistant.apps.chat.services.client_result import ClientToolResult
from ai_assistant.apps.chat.services.perception import vision
from lib.errors import ValidationFailed


class StoredCall(BaseModel):
    """旧批次输入的明确形状；不从客户端接受调用名或入参。"""

    model_config = ConfigDict(extra="forbid")
    call_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    arguments: dict[str, Any]


async def record(
    session: AsyncSession,
    chat_session_id: uuid.UUID,
    results: Sequence[ClientToolResult],
) -> list[str]:
    """匹配全部回执后原子结算并记消息；同值重试不重复。

    Args: session, chat_session_id, results。
    """
    await session_crud.lock_session(session, chat_session_id)
    messages = await session_crud.messages_of(session, chat_session_id)
    grouped = await session_crud.steps_of(session, [row.id for row in messages])
    steps = [step for values in grouped.values() for step in values]
    added = expand_legacy(steps)
    matched = match_results([*steps, *added], results)
    session.add_all(added)
    settle(matched)
    seq = max((row.seq for row in messages), default=0)
    for _step, result in matched:
        seq += 1
        session.add(
            ChatMessage(
                session_id=chat_session_id,
                seq=seq,
                role="tool",
                content_json={
                    "tool_call_id": result.call_id,
                    "text": _output(result)["body"],
                },
            )
        )
    await session.flush()
    return [result.call_id for result in results]


def expand_legacy(steps: Sequence[ChatStep]) -> list[ChatStep]:
    """旧版批次一步拆为逐调用步骤，保留原首行与其消息关系。

    Args: steps。
    """
    orders: dict[uuid.UUID, int] = {}
    for step in steps:
        orders[step.message_id] = max(orders.get(step.message_id, 0), step.seq)
    added: list[ChatStep] = []
    for step in steps:
        if step.kind != "client_tool" or step.state != "awaiting_client":
            continue
        calls = (step.input_json or {}).get("calls")
        if not isinstance(calls, list) or not calls:
            continue
        parsed = TypeAdapter(list[StoredCall]).validate_python(calls)
        first = parsed[0]
        step.name = first.name
        step.input_json = {
            "call_id": first.call_id,
            "arguments": first.arguments,
        }
        for call in parsed[1:]:
            orders[step.message_id] += 1
            added.append(
                ChatStep(
                    message_id=step.message_id,
                    seq=orders[step.message_id],
                    kind="client_tool",
                    name=call.name,
                    state="awaiting_client",
                    input_json={
                        "call_id": call.call_id,
                        "arguments": call.arguments,
                    },
                )
            )
    return added


def match_results(
    steps: Sequence[ChatStep], results: Sequence[ClientToolResult]
) -> list[tuple[ChatStep, ClientToolResult]]:
    """先完整验证再返回需结算项；未知或冲突不能改任何一步。

    Args: steps, results。
    """
    targets: dict[str, ChatStep] = {}
    for step in steps:
        call_id = (step.input_json or {}).get("call_id")
        if step.kind == "client_tool" and isinstance(call_id, str):
            if call_id in targets:
                raise ValidationFailed("客户端调用 id 不唯一，无法匹配回执")
            targets[call_id] = step
    seen: set[str] = set()
    matched: list[tuple[ChatStep, ClientToolResult]] = []
    for result in results:
        if result.call_id in seen or result.call_id not in targets:
            raise ValidationFailed("工具回执 id 重复或没有对应的客户端调用")
        seen.add(result.call_id)
        step = targets[result.call_id]
        if step.state == "awaiting_client":
            matched.append((step, result))
        else:
            stored = (step.output_json or {}).get("receipt_sha256")
            if not isinstance(stored, str):
                raise ValidationFailed(
                    "该调用已有旧版回执，无法验证完整结果是否相同；"
                    "请查看历史，不要重新执行操作"
                )
            if stored != _fingerprint(result):
                raise ValidationFailed("该调用已有不同回执，不能覆盖实际结果")
    return matched


def settle(matched: Sequence[tuple[ChatStep, ClientToolResult]]) -> None:
    """仅记录客户端报告的实际结果；未收到回执的项不推断执行状态。

    Args: matched。
    """
    for step, result in matched:
        step.state = _state(step.name, result)
        step.output_json = _output(result)
        step.error = result.error
        step.ended_at = datetime.now(UTC)


def _output(result: ClientToolResult) -> dict[str, str]:
    return {
        "body": (
            vision.PLACEHOLDER
            if vision.is_image(result.output)
            else result.as_text()
        ),
        "receipt_sha256": _fingerprint(result),
    }


def _fingerprint(result: ClientToolResult) -> str:
    body = json.dumps(
        {"output": result.output, "error": result.error},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _state(name: str, result: ClientToolResult) -> str:
    if result.error is not None:
        return "failed"
    # ⚠ 外部 JSON 产出仅检查这一取消标记；字典的其余值保持不透明
    output: object = result.output
    if (
        name == "user.ask"
        and isinstance(output, dict)
        and cast("dict[str, object]", output).get("is_cancelled") is True
    ):
        return "aborted"
    return "succeeded"
