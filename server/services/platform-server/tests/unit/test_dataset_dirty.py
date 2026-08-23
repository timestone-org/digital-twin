"""台账脏信号：报脏走提交后钩子，且报脏失败绝不毁掉一次已经落库的写入。

⚠ 就地报脏是错的：提交还没落地时告诉发布器「有新数据了」，它抢先读到的是
旧值，然后把旧值当新值推出去（docs/DATASET_DESIGN.md §16）。
"""

import pytest

from lib.errors.base import DependencyUnavailable
from platform_server.apps.dataset.services import DIRTY_TABLES_KEY
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from unit.dataset_fakes import FakeSetSink


class BrokenSink:
    """恒不可达的集合登记口。"""

    def __init__(self) -> None:
        """从零开始数。"""
        self.attempts = 0

    async def add_to_set(self, key: str, *members: str) -> None:
        """一律拒绝，但记下确实被调过。

        Args: key, members。
        """
        self.attempts += 1
        raise DependencyUnavailable(f"缓存服务暂时不可用：{key} {members}")


async def test_marking_a_table_puts_its_code_in_the_shared_set() -> None:
    sink = FakeSetSink()

    await DatasetDirtyLog(sink=sink).mark("shift_output")

    assert sink.members(DIRTY_TABLES_KEY) == {"shift_output"}


async def test_marking_the_same_table_twice_leaves_one_member() -> None:
    # ⚠ 一次提交改十行只该让下游取一次数：用列表的话发布器会白跑十遍
    sink = FakeSetSink()
    log = DatasetDirtyLog(sink=sink)

    await log.mark("shift_output")
    await log.mark("shift_output")

    assert sink.members(DIRTY_TABLES_KEY) == {"shift_output"}


async def test_a_failed_mark_never_escapes() -> None:
    # ⚠ 数据已经落库了，为了一条通知把一次成功的写入变成 500，是拿已经成功
    # 的事去赌一件本来就有兜底的事
    sink = BrokenSink()
    log = DatasetDirtyLog(sink=sink)

    await log.mark("shift_output")

    assert sink.attempts == 1


def test_the_key_is_the_cross_process_contract() -> None:
    # ⚠ 写死不可配：让它可配等于让两份配置各认一个键，而现象只是「大屏不更新」
    assert DIRTY_TABLES_KEY == "platform:dataset:dirty"


@pytest.mark.parametrize("code", ["", " "])
async def test_a_blank_code_still_reaches_the_sink(code: str) -> None:
    # 空编码建不出来（CHECK 约束拦着），这里只钉「报脏不自己发明过滤规则」
    sink = FakeSetSink()

    await DatasetDirtyLog(sink=sink).mark(code)

    assert sink.members(DIRTY_TABLES_KEY) == {code}
