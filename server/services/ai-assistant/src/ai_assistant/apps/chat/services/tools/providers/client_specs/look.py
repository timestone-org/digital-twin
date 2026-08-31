"""整屏外观缺省那两个客户端工具的规格：读大屏级卡片外观、整袋写它。

⚠ 与同目录的 `core.py` 同一口径——只有形状，实现在浏览器里；名字必须与
前端工作面的 `tools` 数组逐字相同。

单节点的外观归 `dashboard.set_config` 与 `dashboard.apply_style`；这两个改的是
**整屏的底**，每个节点自己的那一段盖在它上面。
"""

from ai_assistant.apps.chat.services.tools.shapes import (
    ToolSpec,
    object_schema,
)

LOOK_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="dashboard.read_page_style",
        description=(
            "读**整屏**的卡片外观缺省：这一屏上每一块卡片的底子。"
            "回执里的 `overridden_by` 是自己盖了其中某几个键的那些画布节点"
            "——它们不会跟着整屏变。"
            "⚠ 改整屏之前先读一次：这一段是整袋替换的，不读就写等于把"
            "用户已经调好的那几格一起冲掉。"
        ),
        parameters=object_schema({}, []),
        runs_on="client",
    ),
    ToolSpec(
        name="dashboard.set_page_style",
        description=(
            "把一整套卡片外观写成**整屏的缺省**，一次调用管住全屏每一块卡片，"
            "连之后新加的模块也跟着走。用户说「整屏都换成…」「所有卡片的边框"
            "都去掉」时用它。"
            "⚠ 别改用 `dashboard.set_config` 逐个节点套一遍：那是 N×40 次调用，"
            "而且新加的模块不会跟着变。"
            "⚠ 键取自 `dashboard.chrome_keys`，词汇表外的键当场被拒。"
            "⚠ **整袋替换**：这一袋没写的外观键会被清掉、回落平台默认。"
            "给空对象 `{}` 就是整屏全部回落平台默认。"
            "⚠ 只想改某一块卡片就别用它——那归 `dashboard.apply_style`。"
            "⚠ 整屏外观不在撤销栈上，用户按 Ctrl+Z 退不回来，改完说一句。"
        ),
        parameters=object_schema(
            {
                "chrome": {
                    "type": "object",
                    "description": (
                        "外观整袋，键取自 dashboard.chrome_keys；"
                        "给空对象表示整屏回落平台默认外观"
                    ),
                    "additionalProperties": True,
                },
            },
            ["chrome"],
        ),
        runs_on="client",
    ),
)
