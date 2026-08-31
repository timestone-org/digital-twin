"""工具来源的注册表（ADR-0029 层 5）。

守的是四件事，每一件漏了都不报错、只表现为「模型调一次失败一次」：
两路来源撞了同一个工具名（后来的那一路被遮掉，而遮掉的是哪一个看不出来）、
规格的原序被打乱（顺序影响模型的第一反应）、客户端工具走到服务端却静默成功、
以及静态那份规格清单与实际下发的那份漂开。
"""

from typing import Any

import pytest

from ai_assistant.apps.chat.services.tools.ports import (
    RunsElsewhere,
    ToolProvider,
    UnknownTool,
)
from ai_assistant.apps.chat.services.tools.providers.client import ClientTools
from ai_assistant.apps.chat.services.tools.providers.client_specs import (
    core,
    interaction,
    look,
)
from ai_assistant.apps.chat.services.tools.providers.memory import (
    MEMORY_SPECS,
)
from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.apps.chat.services.tools.providers.server_specs import (
    SERVER_SPECS,
)
from ai_assistant.apps.chat.services.tools.registry import (
    DuplicateTool,
    all_specs,
    build_registry,
    registry_of,
)
from ai_assistant.apps.chat.services.tools.shapes import ToolSpec
from ai_assistant.apps.chat.services.tools.specs import TOOL_SPECS


class _Clashing:
    """一路故意与服务端撞名的假来源，用来验重名闸真的会响。"""

    name = "clashing"

    def specs(self) -> tuple[ToolSpec, ...]:
        return (SERVER_SPECS[0],)

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        raise UnknownTool(f"{name} 收到 {len(arguments)} 个入参")


def test_the_registry_keeps_the_declared_order() -> None:
    """顺序是契约：它决定工具在提示词里的先后，而先后影响模型的第一反应。"""
    expected = (
        SERVER_SPECS
        + MEMORY_SPECS
        + core.CLIENT_SPECS
        + interaction.INTERACTION_SPECS
        + look.LOOK_SPECS
    )
    assert [spec.name for spec in all_specs()] == [
        spec.name for spec in expected
    ]


def test_the_module_level_table_is_the_registry_snapshot() -> None:
    """`TOOL_SPECS` 与执行用的那一份同源，不是手抄的第二份。"""
    assert all_specs() == TOOL_SPECS


def test_specs_do_not_depend_on_the_request_context() -> None:
    """带不带上游取到的规格必须逐字相同。

    依赖了请求上下文的话，静态清单与实际下发的那份会漂开，而两边都不报错。
    """
    bare = [spec.name for spec in build_registry().specs]
    bound = [
        spec.name for spec in build_registry(headers={"x-user-id": "u1"}).specs
    ]
    assert bare == bound


def test_two_sources_may_not_claim_the_same_tool_name() -> None:
    """重名在装配期就抛，不留到运行期让模型调到没预期的那份实现。"""
    with pytest.raises(DuplicateTool) as caught:
        registry_of((ServerTools(), _Clashing()))
    assert SERVER_SPECS[0].name in str(caught.value)


def test_the_live_registry_has_no_duplicate_names() -> None:
    """这套部署真装的那几路彼此不撞名。"""
    names = [spec.name for spec in all_specs()]
    assert len(names) == len(set(names))


def test_every_declared_tool_has_exactly_one_owner() -> None:
    """规格表与分派表出自同一次装配，不该有谁只在其中一边。"""
    registry = build_registry()
    assert set(registry.owners) == {spec.name for spec in registry.specs}


@pytest.mark.asyncio
async def test_a_client_tool_reaching_the_server_says_so_out_loud() -> None:
    """静默成功会让模型以为改好了，最后给用户一个「已完成」而画面纹丝不动。"""
    picked = core.CLIENT_SPECS[0].name
    with pytest.raises(RunsElsewhere) as caught:
        await build_registry().run(picked, {})
    assert picked in str(caught.value)


@pytest.mark.asyncio
async def test_an_unknown_name_is_not_answered_with_an_empty_result() -> None:
    """模型编一个不存在的工具名是常事；给空结果它会当成「查过了，没有」。"""
    with pytest.raises(UnknownTool):
        await build_registry().run("nothing.like_this", {})


def test_both_shipped_sources_satisfy_the_port() -> None:
    """注册进来的实现都要对得上 `ToolProvider` 的形状。"""
    for provider in build_registry().providers:
        assert isinstance(provider, ToolProvider)


def test_the_client_source_declares_every_client_spec() -> None:
    """三份按主题分家的规格必须全部进这一路，漏一份模型就看不见那一批。"""
    listed = {spec.name for spec in ClientTools().specs()}
    for batch in (
        core.CLIENT_SPECS,
        interaction.INTERACTION_SPECS,
        look.LOOK_SPECS,
    ):
        assert {spec.name for spec in batch} <= listed
