"""交叉验证的折切分：下标集合与顺序固定，且在大帧上是线性的。"""

import time

from platform_server.apps.modeling.operators.diagnostics import _folds

# 大帧上切折的耗时上限（秒）。线性实现只要几毫秒，平方实现要十几秒
_BUDGET_S = 2.0


def test_kfold_holds_out_each_block_once() -> None:
    assert _folds(10, 3, "kfold") == [
        ([3, 4, 5, 6, 7, 8, 9], [0, 1, 2]),
        ([0, 1, 2, 6, 7, 8, 9], [3, 4, 5]),
        ([0, 1, 2, 3, 4, 5], [6, 7, 8, 9]),
    ]


def test_forward_chain_only_trains_on_earlier_rows() -> None:
    assert _folds(6, 3, "forward_chain") == [
        ([0, 1], [2, 3]),
        ([0, 1, 2, 3], [4, 5]),
    ]


def test_kfold_on_a_wide_frame_is_linear() -> None:
    started = time.perf_counter()
    made = _folds(60_000, 5, "kfold")
    assert time.perf_counter() - started < _BUDGET_S
    assert sum(len(train) for train, _test in made) == 4 * 60_000
