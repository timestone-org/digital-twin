"""客户端工具那一路：只交规格，不执行。

这一批下发到浏览器、由编辑器改那份本地草稿（ADR-0023）。服务端手上只有它们的
形状，没有实现——所以这一路是个**只声明的 provider**。

⚠ `run` 恒抛而不是静默成功。静默成功会让模型以为改好了、接着往下走，最后给用户
一个「已完成」而画面纹丝不动——那是这套东西最难查的一类故障。
"""

from typing import Any

from ai_assistant.apps.chat.services.tools.providers.client_specs import (
    core,
    interaction,
    look,
)
from llmcore.tools.ports import RunsElsewhere
from llmcore.tools.shapes import ToolSpec


class ClientTools:
    """下发到浏览器执行的那一批。"""

    name = "client"

    def specs(self) -> tuple[ToolSpec, ...]:
        """这一路提供哪些工具。

        ⚠ 顺序是契约的一部分：它决定这几批在提示词里的先后，而先后影响模型的
        第一反应。三份按主题分家只是为了不破模块行数闸，拼接次序不许动。
        """
        return (
            core.CLIENT_SPECS + interaction.INTERACTION_SPECS + look.LOOK_SPECS
        )

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        """恒抛：这一批在浏览器里跑，服务端没有它们的实现。

        Args: name, arguments（收下只为对上 `ToolProvider` 的形状）。
        """
        raise RunsElsewhere(
            f"{name} 在浏览器里执行，服务端没有它的实现；"
            f"它本该随回合交给前端（收到 {len(arguments)} 个入参）"
        )
