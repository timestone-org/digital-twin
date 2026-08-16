"""守子树遍历：拼得回层级、走得完、到点会停、失败分得清是哪一种。

⚠ 这里没有条数上限，也不该有：勾一个通道要的就是它下面的全部点位。遍历会
终止靠的是**按寻址串去重**——那条断言（`test_a_cycle_does_not_walk_forever`）
因此是这一组里最要紧的一条，它塌了就是无限打设备。
"""

import pytest

from collector_server.apps.collect.drivers.base import BrowseItem
from collector_server.apps.collect.services.subtree import (
    DEADLINE_RESERVE_MS,
    walk_subtree,
)
from collector_server.clock import Clock

NOW_MS = 1_767_323_045_000
FAR_DEADLINE_MS = NOW_MS + 60_000


def folder(address: str, *, has_children: bool = True) -> BrowseItem:
    """一个对象节点。

    Args: address, has_children。
    """
    return BrowseItem(
        address=address,
        name=address,
        has_children=has_children,
        is_variable=False,
    )


def tag(address: str) -> BrowseItem:
    """一个变量节点。

    Args: address。
    """
    return BrowseItem(
        address=address, name=address, has_children=False, is_variable=True
    )


class FakeSpace:
    """一棵写死的地址空间，记下每一次被浏览的节点。"""

    def __init__(self, layers: dict[str | None, list[BrowseItem]]) -> None:
        self.layers = layers
        self.asked: list[str | None] = []
        self.failing: set[str | None] = set()

    async def browse(self, parent: str | None) -> list[BrowseItem]:
        self.asked.append(parent)
        if parent in self.failing:
            raise RuntimeError("这一层拉不动")
        return self.layers.get(parent, [])


def clock_at(*values: int) -> Clock:
    """一只按次数往下念的假时钟；念完了停在最后一个值上。

    Args: values。
    """
    remaining = list(values)

    def now() -> int:
        return remaining.pop(0) if len(remaining) > 1 else remaining[0]

    return now


async def test_a_flat_result_still_says_who_each_item_hangs_under() -> None:
    space = FakeSpace(
        {
            "ch": [folder("dev"), tag("ch.a")],
            "dev": [tag("dev.x"), tag("dev.y")],
        }
    )

    result = await walk_subtree(
        space.browse,
        "ch",
        deadline_ms=FAR_DEADLINE_MS,
        clock=lambda: NOW_MS,
    )

    assert [(one.parent, one.item.address) for one in result.entries] == [
        ("ch", "dev"),
        ("ch", "ch.a"),
        ("dev", "dev.x"),
        ("dev", "dev.y"),
    ]
    assert result.is_truncated is False


async def test_variables_are_leaves_even_if_they_claim_children() -> None:
    # ⚠ 变量的子节点是工程单位一类的属性，不是点位；跟下去等于白打设备
    space = FakeSpace({"ch": [tag("ch.a")], "ch.a": [tag("ch.a.EU")]})

    result = await walk_subtree(
        space.browse,
        "ch",
        deadline_ms=FAR_DEADLINE_MS,
        clock=lambda: NOW_MS,
    )

    assert space.asked == ["ch"]
    assert len(result.entries) == 1


async def test_an_empty_folder_yields_nothing_and_is_not_truncated() -> None:
    space = FakeSpace({"ch": []})

    result = await walk_subtree(
        space.browse,
        "ch",
        deadline_ms=FAR_DEADLINE_MS,
        clock=lambda: NOW_MS,
    )

    assert result.entries == ()
    assert result.is_truncated is False


async def test_a_cycle_does_not_walk_forever() -> None:
    # 同一个节点挂在多处是合法的地址空间；不去重就绕着环一直打设备
    space = FakeSpace({"a": [folder("b")], "b": [folder("a"), tag("b.x")]})

    result = await walk_subtree(
        space.browse,
        "a",
        deadline_ms=FAR_DEADLINE_MS,
        clock=lambda: NOW_MS,
    )

    assert space.asked == ["a", "b"]
    assert [one.item.address for one in result.entries] == ["b", "b.x"]


async def test_a_big_subtree_comes_back_whole_not_capped_at_some_number() -> (
    None
):
    # ⚠ 勾一个通道要的就是它下面的**全部**点位。按条数掐断等于替用户决定他
    # 只要前 N 个，而他多半到建完点位才发现少了
    layers = {"ch": [folder(f"dev{index}") for index in range(40)]}
    for index in range(40):
        layers[f"dev{index}"] = [tag(f"dev{index}.t{one}") for one in range(50)]
    space = FakeSpace(layers)

    result = await walk_subtree(
        space.browse,
        "ch",
        deadline_ms=FAR_DEADLINE_MS,
        clock=lambda: NOW_MS,
    )

    variables = [one for one in result.entries if one.item.is_variable]
    assert len(variables) == 2000
    assert len(space.asked) == 41
    assert result.is_truncated is False


async def test_the_callers_deadline_stops_the_walk_before_it_expires() -> None:
    # ⚠ 发起方早就超时走人了，这时候再问现场只是白占一次设备往返
    space = FakeSpace({"a": [folder("b")], "b": [tag("b.x")]})
    deadline_ms = NOW_MS + 10_000
    late_ms = deadline_ms - DEADLINE_RESERVE_MS

    result = await walk_subtree(
        space.browse,
        "a",
        deadline_ms=deadline_ms,
        clock=clock_at(NOW_MS, late_ms),
    )

    assert space.asked == ["a"]
    assert result.is_truncated is True


async def test_a_dead_first_layer_is_raised_not_swallowed() -> None:
    # 「这个数据源浏览不了」与「里面有一枝拉不动」是两回事
    space = FakeSpace({"a": [tag("a.1")]})
    space.failing = {"a"}

    with pytest.raises(RuntimeError):
        await walk_subtree(
            space.browse,
            "a",
            deadline_ms=FAR_DEADLINE_MS,
            clock=lambda: NOW_MS,
        )


async def test_a_dead_branch_only_truncates_the_rest_keeps_walking() -> None:
    space = FakeSpace(
        {
            "a": [folder("bad"), folder("good")],
            "good": [tag("good.x")],
        }
    )
    space.failing = {"bad"}

    result = await walk_subtree(
        space.browse,
        "a",
        deadline_ms=FAR_DEADLINE_MS,
        clock=lambda: NOW_MS,
    )

    assert [one.item.address for one in result.entries] == [
        "bad",
        "good",
        "good.x",
    ]
    assert result.is_truncated is True


async def test_walking_from_the_root_marks_the_first_layer_as_parentless() -> (
    None
):
    space = FakeSpace({None: [folder("ch")], "ch": [tag("ch.a")]})

    result = await walk_subtree(
        space.browse,
        None,
        deadline_ms=FAR_DEADLINE_MS,
        clock=lambda: NOW_MS,
    )

    assert result.entries[0].parent is None
    assert result.entries[1].parent == "ch"
