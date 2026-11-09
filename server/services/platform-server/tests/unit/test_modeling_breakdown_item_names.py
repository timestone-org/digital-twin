"""按项的一组数：项名一律写在 `name` 上，开关不印成 0/1 的数卡。

⚠ 前端按 `name` 取项名：写在别的键上的项整片没有标题，且没有任何报错。
"""

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    Provenance,
    registry,
)
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.operators.supervised_report import (
    SupervisedRun,
    supervised_blocks,
)
from unit.modeling_fakes import hints_of

MINUTE_MS = 60_000


def history() -> Frame:
    """一段两行的历史观测。"""
    return Frame(
        columns=(FrameColumn(key="load", name="负荷", dtype="number"),),
        rows=((1.0,), (2.0,)),
        index=(0, 30 * MINUTE_MS),
        provenance=Provenance(table_codes=("load",)),
    )


def supervised_run(*, should_standardize: bool) -> SupervisedRun:
    """一份最小的监督拟合记录。Args: should_standardize。"""
    return SupervisedRun(
        algorithm_name="随机森林",
        training_rows=80,
        feature_count=3,
        truth=(1.0, 2.0),
        predicted=(1.0, 2.5),
        is_classification=False,
        should_standardize=should_standardize,
        notices=(),
    )


def item_names(block: ReportBlock) -> list[object]:
    """逐项的项名。Args: block。"""
    return [item.get("name") for item in block.payload["items"]]


def test_supervised_items_carry_their_name() -> None:
    for block in supervised_blocks(supervised_run(should_standardize=True)):
        names = item_names(block)
        assert names
        assert all(isinstance(name, str) and name for name in names)


def test_standardization_is_said_in_words_not_as_a_number() -> None:
    on, _ = supervised_blocks(supervised_run(should_standardize=True))
    off, _ = supervised_blocks(supervised_run(should_standardize=False))
    keys = [item.get("key") for item in on.payload["items"]]
    assert "scaling" not in keys
    assert any("已在训练集内标准化" in text for text in hints_of(on))
    assert any("未做标准化" in text for text in hints_of(off))


def test_time_shift_items_carry_their_name() -> None:
    operator, _ = registry.build("time_shift", {"offset_minutes": 30})
    operator.run({"frame": history()})
    (block,) = operator.report()
    assert item_names(block) == ["历史观测向后平移"]
