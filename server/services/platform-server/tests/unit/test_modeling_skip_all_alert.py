"""填缺失 / 离群裁剪的列全被跳过时，讲解直说这一步没有作用，发布拒绝也给出路。

⚠ 拒绝理由只说「请重跑」的话，重跑出来的还是空参数，用户被困住。
"""

from typing import Any

from platform_server.apps.modeling.operators import Frame, FrameColumn, registry
from platform_server.apps.modeling.operators.fitreport import NOTHING_FITTED
from platform_server.apps.modeling.operators.reporting import ReportBlock
from unit.modeling_fakes import alerts_of


def _blank() -> Frame:
    """一列全空的数值列。"""
    return Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=((None,), (None,)),
    )


def _report(code: str, **config: Any) -> tuple[ReportBlock, ...]:
    """Args: code, config。"""
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": _blank()})
    return operator.report()


def test_fill_missing_says_every_column_was_skipped() -> None:
    blocks = _report("fill_missing", on_all_null="skip")
    assert NOTHING_FITTED in alerts_of(blocks[0])


def test_clip_outlier_says_every_column_was_skipped() -> None:
    blocks = _report("clip_outlier", on_no_bound="skip")
    assert NOTHING_FITTED in alerts_of(blocks[0])
