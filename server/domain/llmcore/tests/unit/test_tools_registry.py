"""把几路来源装成一个注册表，以及按名字分派。"""

import pytest

from llmcore.tools import shapes
from llmcore.tools.ports import UnknownTool
from llmcore.tools.registry import DuplicateTool, registry_of
from llmcore.tools.shapes import ToolSpec


def _spec(name: str) -> ToolSpec:
    return ToolSpec(
        name=name,
        description="随便",
        parameters=shapes.object_schema({}, []),
        runs_on="server",
    )


class _Source:
    def __init__(self, name: str, tools: tuple[str, ...]) -> None:
        self._name = name
        self._tools = tools
        self.ran: list[str] = []

    @property
    def name(self) -> str:
        return self._name

    def specs(self) -> tuple[ToolSpec, ...]:
        return tuple(_spec(one) for one in self._tools)

    async def run(self, name: str, arguments: dict[str, object]) -> object:
        del arguments
        self.ran.append(name)
        return {"from": self._name}


def test_registration_order_is_the_order_specs_come_out() -> None:
    """⚠ 顺序是契约：它决定工具在提示词里的先后，而先后影响模型的第一反应。"""
    made = registry_of((_Source("甲", ("a", "b")), _Source("乙", ("c",))))

    assert [spec.name for spec in made.specs] == ["a", "b", "c"]


async def test_dispatch_goes_to_the_source_that_declared_it() -> None:
    first, second = _Source("甲", ("a",)), _Source("乙", ("b",))
    made = registry_of((first, second))

    assert await made.run("b", {}) == {"from": "乙"}
    assert first.ran == []
    assert second.ran == ["b"]


async def test_an_unknown_name_raises_instead_of_returning_nothing() -> None:
    """⚠ 静默给空结果时，模型会当成「查过了，没有」接着往下走。"""
    made = registry_of((_Source("甲", ("a",)),))

    with pytest.raises(UnknownTool):
        await made.run("没这个", {})


def test_two_sources_claiming_one_name_blow_up_at_assembly_time() -> None:
    """⚠ 留到运行期的话，被遮掉的是哪一个从外面完全看不出来。"""
    with pytest.raises(DuplicateTool):
        registry_of((_Source("甲", ("a",)), _Source("乙", ("a",))))


def test_specs_of_returns_only_that_sources_share() -> None:
    made = registry_of((_Source("甲", ("a", "b")), _Source("乙", ("c",))))

    assert [spec.name for spec in made.specs_of("乙")] == ["c"]


def test_the_schema_helpers_shut_the_door_on_extra_keys() -> None:
    """⚠ 不关门的话，模型多塞一格参数不会报错，而那一格谁也没读。"""
    made = shapes.object_schema({"q": shapes.string_schema("问什么")}, ["q"])

    assert made["additionalProperties"] is False
    assert made["required"] == ["q"]
    assert shapes.integer_schema("几条")["type"] == "integer"
    assert (
        shapes.string_array_schema("一批", "一个")["items"]["type"] == "string"
    )
