"""客户端工具那一路：只有 `user.ask`，只交规格，不执行。

⚠ 参数形状与助手那边**逐字相同**：浏览器里实现它的是同一份代码
（`web/app/src/features/ai/builtinTools.ts`），形状漂开前端就渲染不出选项。
由契约测试钉住。

⚠ `run` 恒抛而不是静默成功。静默成功会让模型以为问过了、接着往下走，最后按
它自己猜的那个选项答了，而用户根本没见到问题。
"""

from typing import Any

from llmcore.tools.ports import RunsElsewhere
from llmcore.tools.shapes import ToolSpec, object_schema, string_schema

ASK_TOOL = "user.ask"

ASK_SPEC = ToolSpec(
    name=ASK_TOOL,
    description=(
        "问题有歧义、要用户拿主意时问他：问题与选项在页面上渲染成一排可点的"
        "按钮，回执是 `{picked, free_text, is_cancelled}`。"
        "⚠ `options` **必给**、2–6 个，且要互斥地穷尽这一步的分叉，"
        "最可能的那个排第一。"
        "⚠ **不要在正文里问一句等用户打字**：用户不知道该补什么。"
        "⚠ 用户不回答时回的是 `is_cancelled: true`，那是一条**正常回执**"
        "而不是失败：按最可能的那一种往下走并说明。"
        "⚠ **必须单独成一批**：这一次调用里除了它不许有别的工具。"
    ),
    parameters=object_schema(
        {
            "question": string_schema("一句话问题，一次只问一件事"),
            "options": {
                "type": "array",
                "description": "备选项，2–6 个，最可能的排第一个",
                "items": {
                    "type": "object",
                    "properties": {
                        "value": string_schema("这一项的取值，回执按它认"),
                        "label": string_schema("按钮上的字，一行以内"),
                        "hint": string_schema("补一句这一项意味着什么，可省"),
                    },
                    "required": ["value", "label"],
                    "additionalProperties": False,
                },
            },
            "allow_multiple": {
                "type": "boolean",
                "description": "允许多选，缺省 false",
            },
            "allow_free_text": {
                "type": "boolean",
                "description": (
                    "除选项外再给一个输入框，缺省 false；给了也仍然要给选项"
                ),
            },
        },
        ["question", "options"],
    ),
    runs_on="client",
)


class ClientTools:
    """下发到浏览器执行的那一批：只有反问。"""

    name = "client"

    def specs(self) -> tuple[ToolSpec, ...]:
        """这一路提供哪些工具。"""
        return (ASK_SPEC,)

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        """恒抛：这一批在浏览器里跑，服务端没有它们的实现。

        Args: name, arguments（收下只为对上 `ToolProvider` 的形状）。
        """
        raise RunsElsewhere(
            f"{name} 在浏览器里执行，服务端没有它的实现；"
            f"它本该随回合交给前端（收到 {len(arguments)} 个入参）"
        )
