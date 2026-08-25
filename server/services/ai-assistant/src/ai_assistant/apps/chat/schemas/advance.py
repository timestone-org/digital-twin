"""推进一个回合的入参。

⚠ 用户发话与工具回填**二选一**。同时给的话，模型会在同一轮里既看到一句新的
要求、又看到上一轮的工具结果——它多半会把两件事揉成一件做。
"""

import json
from typing import Any, Self

from pydantic import Field, field_validator, model_validator

from ai_assistant.apps.chat.schemas.common import InputModel
from ai_assistant.apps.chat.schemas.session import SurfaceKind
from ai_assistant.settings import MAX_IMAGE_CHARS

# 一次回填最多带几条。与一次能下发的客户端工具数同量级
MAX_TOOL_RESULTS = 32
MAX_USER_TEXT = 4000
MAX_SURFACE_LABEL = 64
# 工作面快照序列化之后的字符上限。⚠ 有上限：一屏两千个画布节点的摘要能有
# 十几万字，而这一段每一轮都要重发一次
MAX_SURFACE_CONTEXT_CHARS = 40_000


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
    # 这一屏此刻的摘要，进提示词。⚠ **每次推进都要带**：提示词一轮一拼，
    # 只在用户发话那次带的话，助手动了两下之后看到的是一屏过期的画布
    surface_context: dict[str, Any] | None = None
    user_text: str | None = Field(default=None, max_length=MAX_USER_TEXT)
    tool_results: list[ToolResultIn] = Field(
        default_factory=list[ToolResultIn], max_length=MAX_TOOL_RESULTS
    )

    @field_validator("surface_context")
    @classmethod
    def check_context_size(
        cls, given: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        """快照不许大到把提示词挤没。

        ⚠ 拒收而不是就地截断：截断出来的是一段不合法的 JSON，而模型读它读到
        一半会当成「这一屏就这么多」，然后对着半屏画布下结论。

        Args: given。
        """
        if given is None:
            return None
        body = json.dumps(given, ensure_ascii=False, default=str)
        if len(body) > MAX_SURFACE_CONTEXT_CHARS:
            raise ValueError("工作面快照太大，请只带摘要")
        return given

    @model_validator(mode="after")
    def check_exactly_one_source(self) -> Self:
        """发话与回填二选一，且必须有一个。"""
        has_text = self.user_text is not None
        has_results = bool(self.tool_results)
        if has_text == has_results:
            raise ValueError("user_text 与 tool_results 必须二选一")
        return self
