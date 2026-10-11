"""浏览器真实工具回执的统一有界文本与图占位口径。"""

from dataclasses import dataclass
from typing import Any

from ai_assistant.apps.chat.services.perception import vision
from ai_assistant.settings import MAX_TOOL_RESULT_CHARS
from llmcore.output.tool_text import format_tool_output


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
            return f"失败：{self.error}\n" + format_tool_output(
                {
                    "code": "client_tool_failed",
                    "execution": "unknown",
                    "retryable": False,
                    "next_action": (
                        "先核对当前页面和工具参数；写操作须读回确认实际状"
                        "态，再决定是否需要修正。不要重复执行结果未知的操"
                        "作。"
                    ),
                },
                1200,
            )
        # ⚠ 图不放在工具消息里：那一层只认文字，塞进去多半被整条丢掉，
        # 表现是模型说「我没看到图」而调用明明成功了
        if vision.is_image(self.output):
            return vision.HANDOFF
        return format_tool_output(self.output, MAX_TOOL_RESULT_CHARS)

    def image(self) -> str | None:
        """这一条带回来的图；没有就是 None。"""
        if not vision.is_image(self.output):
            return None
        return str(self.output)
