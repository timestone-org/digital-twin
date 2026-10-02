"""浏览器真实工具回执的统一有界文本与图占位口径。"""

import json
from dataclasses import dataclass
from typing import Any

from ai_assistant.apps.chat.services.perception import vision
from ai_assistant.settings import MAX_TOOL_RESULT_CHARS


@dataclass(frozen=True)
class ClientToolResult:
    """浏览器跑完一个客户端工具之后带回来的东西。"""

    call_id: str
    # 成功时的产出；失败时给 None 并填 error
    output: Any = None
    error: str | None = None

    def as_text(self) -> str:
        """摊成模型认的一段工具输出。"""
        if self.error is not None:
            return f"失败：{self.error}"
        # ⚠ 图不放在工具消息里：那一层只认文字，塞进去多半被整条丢掉，
        # 表现是模型说「我没看到图」而调用明明成功了
        if vision.is_image(self.output):
            return vision.HANDOFF
        if isinstance(self.output, str):
            body, is_json = self.output, False
        else:
            body, is_json = _json_text(self.output), True
        if len(body) <= MAX_TOOL_RESULT_CHARS:
            return body
        if is_json:
            return _truncated_json(body)
        return (
            f"{body[:MAX_TOOL_RESULT_CHARS]}\n"
            f"……（产出太大已截断，共 {len(body)} 字）"
        )

    def image(self) -> str | None:
        """这一条带回来的图；没有就是 None。"""
        if not vision.is_image(self.output):
            return None
        return str(self.output)


def _json_text(output: object) -> str:
    return json.dumps(output, ensure_ascii=False, default=str)


def _truncated_json(body: str) -> str:
    return _json_text(
        {
            "is_truncated": True,
            "preview": body[: MAX_TOOL_RESULT_CHARS // 3],
            "total_chars": len(body),
        }
    )
