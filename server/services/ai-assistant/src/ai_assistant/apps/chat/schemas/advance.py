"""推进一个回合的入参。

⚠ 用户发话与工具回填**二选一**。同时给的话，模型会在同一轮里既看到一句新的
要求、又看到上一轮的工具结果——它多半会把两件事揉成一件做。
"""

from typing import Any, Self

from pydantic import Field, field_validator, model_validator

from ai_assistant.apps.chat.schemas.common import InputModel
from ai_assistant.apps.chat.schemas.session import SurfaceKind
from ai_assistant.settings import MAX_IMAGE_CHARS

# 一次回填最多带几条。与一次能下发的客户端工具数同量级
MAX_TOOL_RESULTS = 32
MAX_USER_TEXT = 4000
MAX_SURFACE_LABEL = 64


class ToolResultIn(InputModel):
    """浏览器跑完一个客户端工具之后带回来的东西。"""

    # ⚠ 必须是模型给的那个 id 逐字原样：对不上的话，模型看到的是「我问了 A，
    # 回来的是 B 的答案」，而它多半会顺着错的往下走
    call_id: str = Field(min_length=1, max_length=128)
    output: Any = None
    error: str | None = Field(default=None, max_length=1000)

    @field_validator("output")
    @classmethod
    def check_size(cls, given: Any) -> Any:
        """产出不许大到把进程压垮。

        ⚠ 只量字符串：能大到成问题的只有内嵌的图，而对一袋结构化结果做序列化
        测长，等于每个请求都白跑一遍 JSON 编码。

        Args: given。
        """
        if isinstance(given, str) and len(given) > MAX_IMAGE_CHARS:
            raise ValueError("工具产出太大，截图请先缩小再传")
        return given


class AdvanceIn(InputModel):
    """推进一个回合。"""

    surface_kind: SurfaceKind
    # 给人看的页面名，进提示词。留空就用工作面标识
    surface_label: str = Field(default="", max_length=MAX_SURFACE_LABEL)
    user_text: str | None = Field(default=None, max_length=MAX_USER_TEXT)
    tool_results: list[ToolResultIn] = Field(
        default_factory=list[ToolResultIn], max_length=MAX_TOOL_RESULTS
    )

    @model_validator(mode="after")
    def check_exactly_one_source(self) -> Self:
        """发话与回填二选一，且必须有一个。"""
        has_text = self.user_text is not None
        has_results = bool(self.tool_results)
        if has_text == has_results:
            raise ValueError("user_text 与 tool_results 必须二选一")
        return self
