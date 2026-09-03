"""全量结果导出：CSV 的形状与那道行数上限。

⚠ 这一组盯的是「导出来的东西对不对得上台账」：带索引的帧要把时刻写成第一列，
不写的话导出来的数据没法与台账对齐，而那正是导出的用处
（docs/MODELING_PLATFORM_DESIGN.md D12）。
"""

from lib.testing import FakeObjectStore
from platform_server.apps.modeling.operators import Frame, FrameColumn
from platform_server.apps.modeling.services import frame_export

TEMPERATURE = "温度"
LOAD = "负荷"
STEP_MS = 3_600_000


def _frame(rows: int, *, has_index: bool = True) -> Frame:
    return Frame(
        columns=(
            FrameColumn(key=TEMPERATURE, name=TEMPERATURE, dtype="number"),
            FrameColumn(key=LOAD, name=LOAD, dtype="number"),
        ),
        rows=tuple((20.0 + index, 400.0 + index) for index in range(rows)),
        index=(
            tuple(index * STEP_MS for index in range(rows))
            if has_index
            else None
        ),
    )


def test_the_moment_is_the_first_column() -> None:
    """带索引的帧把时刻写成第一列。

    ⚠ 不写的话导出来的数据没法与台账对齐——而那正是导出的用处。
    """
    payload, _, _ = frame_export.to_csv(_frame(2))
    head = payload.decode("utf-8").splitlines()[0]
    assert head.split(",") == [frame_export.INDEX_HEADER, TEMPERATURE, LOAD]


def test_a_frame_without_an_index_has_no_moment_column() -> None:
    """没有索引的帧不凭空造一列时刻。"""
    payload, _, _ = frame_export.to_csv(_frame(2, has_index=False))
    head = payload.decode("utf-8").splitlines()[0]
    assert head.split(",") == [TEMPERATURE, LOAD]


def test_every_row_comes_out() -> None:
    """行数对得上：表头一行 + 数据若干行。"""
    payload, kept, is_truncated = frame_export.to_csv(_frame(50))
    assert kept == 50
    assert len(payload.decode("utf-8").splitlines()) == 51
    assert is_truncated is False


def test_an_oversized_frame_is_cut_and_says_so() -> None:
    """超过上限时切掉，并**明说切过**。

    ⚠ 不说的话，用户拿到一份看起来完整的 CSV，而后半段数据根本不在里面。
    """
    frame = _frame(frame_export.MAX_EXPORT_ROWS + 5)
    _, kept, is_truncated = frame_export.to_csv(frame)
    assert kept == frame_export.MAX_EXPORT_ROWS
    assert is_truncated is True


async def test_writing_lands_under_the_run_prefix() -> None:
    """写出去的键落在这次运行自己的前缀底下。

    ⚠ 保留期清理按 `modeling/runs/{run_id}/` 整片删；落在别处的 CSV 永远不会
    被清掉，而它们里面是台账原始数据。
    """
    store = FakeObjectStore()
    written = await frame_export.write_all(
        store, "run-1", "node-1", {"frame": _frame(3)}
    )
    assert written["frame"]["object_key"].startswith("modeling/runs/run-1/")
    assert set(store.objects) == {
        frame_export.frame_key("run-1", "node-1", "frame")
    }


async def test_nothing_is_written_without_a_store() -> None:
    """没配对象存储时什么都不写，也不抛。"""
    assert (
        await frame_export.write_all(None, "run-1", "n", {"frame": _frame(1)})
        == {}
    )


async def test_a_storage_hiccup_does_not_lose_the_other_ports() -> None:
    """某个端口写不进去时，别的端口照样写完。

    ⚠ 全量产物是附加品：为它把一次跑通的训练判成失败是本末倒置。
    """
    store = FakeObjectStore()
    written = await frame_export.write_all(
        store, "run-2", "node-1", {"train": _frame(2), "test": _frame(2)}
    )
    assert sorted(written) == ["test", "train"]
