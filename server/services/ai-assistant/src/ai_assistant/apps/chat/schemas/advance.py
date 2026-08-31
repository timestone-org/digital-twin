"""推进一个回合的入参。

⚠ 用户发话与工具回填**二选一**。同时给的话，模型会在同一轮里既看到一句新的
要求、又看到上一轮的工具结果——它多半会把两件事揉成一件做。
"""

import json
from typing import Annotated, Any, Self

from pydantic import Field, field_validator, model_validator

from ai_assistant.apps.chat.schemas.common import InputModel
from ai_assistant.apps.chat.schemas.session import SurfaceKind
from ai_assistant.settings import MAX_IMAGE_CHARS

# 一次回填最多带几条。⚠ 量的是**一步里的调用条数**，不是工具的种类数——
# 模型一步要三十几个 `dashboard.set_geometry` 是常态（实测见过 37 个），
# 而这一格卡在 32 的表现是：那一步的回执整批被判 400，浏览器收到「事件流
# 打不开」，且那些调用从此没有回执——历史里留下一批没人应答的 tool_calls，
# 于是**这个会话再也发不出下一句**（端点判整段历史不合法）。
# 尾部那批孤儿调用现在由 `history.unanswered` 兜底，但上限本身也得够用。
MAX_TOOL_RESULTS = 128
MAX_USER_TEXT = 4000
# 一句话最多贴几张图。⚠ 有上限：每张图都是一份完整的视觉档载荷，贴上十张
# 会把这一轮的上下文与账单一起顶穿，而现象只是「这一句特别慢」
MAX_USER_IMAGES = 4
MAX_SURFACE_LABEL = 64
# 页面自报的客户端工具名单上限。真实页面十几个，64 已是数倍余量
MAX_CLIENT_TOOLS = 64
MAX_TOOL_NAME = 64
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
    # 用户随这句话贴的图，完整的 `data:image/...;base64,...`。
    # ⚠ 这里只卡条数与长度；**认不认这种图由解码器判**（按字节魔数，不按声明的
    # media type——声明是调用方说了算的）。判定收在 `perception/decoders/image`，
    # 前端那道只管界面提示，拦不住直接打端点的调用方
    user_images: list[
        Annotated[str, Field(min_length=1, max_length=MAX_IMAGE_CHARS)]
    ] = Field(default_factory=list[str], max_length=MAX_USER_IMAGES)
    tool_results: list[ToolResultIn] = Field(
        default_factory=list[ToolResultIn], max_length=MAX_TOOL_RESULTS
    )
    # 这一页实现了哪些客户端工具，前端每轮自报；没实现的模型看不见。
    # ⚠ None 与空表是两回事：None 是老前端没带这一格（退回技能声明推导），
    # 空表是这一页明说自己一个客户端工具都没有
    client_tools: (
        list[Annotated[str, Field(min_length=1, max_length=MAX_TOOL_NAME)]]
        | None
    ) = Field(default=None, max_length=MAX_CLIENT_TOOLS)

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
        """发话与回填二选一，且必须有一个；图只跟着发话走。

        ⚠ 图不许跟工具回填一起来：那一批消息与它们的调用必须相邻，中间插一条
        带图的用户消息会把它们拆开，而有的端点按相邻性校验这一段。
        """
        has_text = self.user_text is not None
        has_results = bool(self.tool_results)
        if has_text == has_results:
            raise ValueError("user_text 与 tool_results 必须二选一")
        if self.user_images and not has_text:
            raise ValueError("user_images 只能跟着 user_text 一起发")
        return self
