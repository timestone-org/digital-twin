"""全部工具的规格表：由注册表汇总产出，技能清单与提示词都按它取。

⚠ 这一份**不再手写「两段相加」**。规格与实现收在各自的 `ToolProvider` 上：
服务端那一路是 `providers/server.py`（规格在同目录的 `server_specs.py`，
分两份文件只为不破模块行数闸），客户端那一路是 `providers/client.py`。
这里只把注册表造出来那一刻的快照摊成一个模块级常量。

⚠ 名字在全表内唯一，而这条不再靠注释守：`registry_of` 在装配期就抛
`DuplicateTool`。重名时后注册的那一路会被遮掉，而遮掉的是哪一个从外面完全看
不出来——模型调到的是它没预期的那份实现。
"""

from ai_assistant.apps.chat.services.tools.registry import all_specs
from llmcore.tools.shapes import ToolSpec

TOOL_SPECS: tuple[ToolSpec, ...] = all_specs()


def spec_of(name: str) -> ToolSpec | None:
    """按名字找规格；没有就给 None。

    Args: name。
    """
    return next((spec for spec in TOOL_SPECS if spec.name == name), None)


def specs_named(names: tuple[str, ...]) -> tuple[ToolSpec, ...]:
    """按名字取一组规格，认不出的名字直接跳过。

    ⚠ 跳过而不是抛：技能清单里可能声明了本期还没实现的工具，那时的正解是
    「模型看不见它」，而不是整个服务起不来。

    Args: names。
    """
    found = (spec_of(name) for name in names)
    return tuple(spec for spec in found if spec is not None)
