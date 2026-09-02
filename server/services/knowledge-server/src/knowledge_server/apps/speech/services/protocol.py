"""浏览器 ↔ knowledge-server 之间语音输入的消息契约：常量、帧的形状、关闭码。

⚠ 这里是**唯一真源**：前端 `features/speech/protocol.ts` 复述一份，由
`web/app/tests/contract/speech-protocol.contract.spec.ts` 按路径读本文件逐字
比对。改任何一个字面量都要连着前端一起改；只改一边的表现是「握手成功、
一个字都不出来」。信封口径见 docs/agents/api-contract.md §10，设计见 ADR-0038。
"""

import json
from dataclasses import dataclass
from typing import cast

# 端点路径。⚠ 字面量而不是拼出来的：前端契约用例按文本读它
SPEECH_WS_PATH = "/api/v1/knowledge/speech/ws"
# 与 access token 一起报上来的子协议标记；服务端 accept 时回它。
# ⚠ 回 token 等于把它写进响应头，会落进代理与浏览器的日志
AUTH_SUBPROTOCOL = "dt.auth"

# 客户端 → 服务端的文本帧 `{"action": …}`：这一句说完了 / 作废
ACTION_STOP = "stop"
ACTION_CANCEL = "cancel"

# 服务端 → 客户端的信封 `type`
TYPE_SYSTEM = "system"
TYPE_DATA = "data"
TYPE_ERROR = "error"
# `system` 帧的 `event`：到 FunASR 的腿已通 / 终稿收齐、随后关连接
EVENT_READY = "ready"
EVENT_DONE = "done"
# `data` 帧 `payload.stage`：在线增量 / 离线整句修正
STAGE_PARTIAL = "partial"
STAGE_FINAL = "final"

# 关闭码
CLOSE_NORMAL = 1000
# 收到认不出的文本帧
CLOSE_BAD_FRAME = 1003
# 未认证或无 knowledge:use。⚠ 与 1013 分开：这一档客户端不该重连
CLOSE_UNAUTHENTICATED = 1008
# 中继自己出错
CLOSE_INTERNAL_ERROR = 1011
# 语音识别没接、FunASR 连不上或中途断
CLOSE_ASR_UNAVAILABLE = 1013

# 客户端文本帧里带动作的那个键
ACTION_KEY = "action"
ACTIONS = frozenset({ACTION_STOP, ACTION_CANCEL})


@dataclass(frozen=True)
class Transcript:
    """一次回给浏览器的转写。

    ⚠ `text` 永远是**整段**（已定稿各句 + 当前句的在线增量），客户端整体替换、
    不自己拼：让客户端拼的话，一帧丢了或重了，两侧的文本就永远对不上。
    """

    stage: str
    text: str


def ready_frame() -> dict[str, object]:
    return {"type": TYPE_SYSTEM, "event": EVENT_READY}


def done_frame() -> dict[str, object]:
    return {"type": TYPE_SYSTEM, "event": EVENT_DONE}


def transcript_frame(transcript: Transcript) -> dict[str, object]:
    """一帧转写。

    Args: transcript。
    """
    return {
        "type": TYPE_DATA,
        "payload": {"stage": transcript.stage, "text": transcript.text},
    }


def error_frame(code: int, message: str) -> dict[str, object]:
    """一帧错误，随后关连接。

    Args: code, message。
    """
    return {"type": TYPE_ERROR, "code": code, "message": message}


def client_action(raw: str) -> str | None:
    """解客户端文本帧里的动作；不是 JSON 对象、没有动作或动作不认识就给 None。

    Args: raw。
    """
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    action = cast("dict[str, object]", parsed).get(ACTION_KEY)
    if not isinstance(action, str) or action not in ACTIONS:
        return None
    return action
