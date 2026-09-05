"""主成分那一步的结果面算料：压缩说明、碎石图与载荷、逐条轴的线性组合。

⚠ pc1…pcK 本身是几列没有物理含义的数，这里的三块合起来只回答一个问题——
每条轴主要由哪几列构成（docs/MODELING_RESULT_VIEW_DESIGN.md §5-12）。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

from platform_server.apps.modeling.operators.reporting import (
    MAX_LOADING_WIDTH,
    MAX_LOADINGS,
    TIER_LARGE,
    TIER_SMALL,
    BlockAt,
    ColumnChange,
    Item,
    ModelStructure,
    ReportBlock,
    columns_block,
    fits_block,
    structure_block,
)

# 主成分算子只有一路输出，讲解全挂在它上面
PORT = "frame"
# 公式里每条轴只列权重绝对值最大的这么多项：20 条轴 × 60 列全列出来光这一块
# 就是几百 KB，而读者要的只是「主要由哪几列构成」
MAX_TERMS = 6
# 权重与比例留这么多位小数：热力图与公式上再多的位数换不来一个像素
WEIGHT_DIGITS = 6

# 主成分对空值零容忍——`matrix_of` 遇到一格空值当场抛
BLANK_NOTE = (
    "这一步要求上游先把缺失填掉：压的这几列里只要有一格是空的，整步会当场报错"
)
# 用户最容易在这里卡住的一句话
OPAQUE_NOTE = (
    "pc1…pcK 没有物理含义：每一列 = 各原列先减去自己的中心点、"
    "再按一组权重加起来。哪几列占大头见「怎么算的」那一段与载荷矩阵"
)
# 载荷与公式各自被截到上限时说一句，不说的话缺的那几条看不出来
CUT_NOTE = "轴或列太多，载荷矩阵只画得下前 {rows} 条轴 × 前 {columns} 列"
TERMS_NOTE = (
    "每条轴只列了权重绝对值最大的前 {terms} 项，完整的一组权重在载荷矩阵里"
)


@dataclass(frozen=True)
class PcaRun:
    """主成分这一步实际做了什么，`pca_blocks` 照它讲。"""

    #: 被压掉的那几列，与载荷的**列**序一致
    columns: tuple[str, ...]
    #: 造出来的主成分列，与载荷的**行**序一致
    made: tuple[str, ...]
    #: 各列的中心点，与 `columns` 同序
    mean: Sequence[float]
    #: 载荷：一行一条轴，一列一个原列
    components: Sequence[Sequence[float]]
    #: 每条轴解释掉的方差比例；空清单 = 这一趟没拟合，拿不到
    explained: Sequence[float]
    #: 输出帧上还剩几列
    kept: int
    train_rows: int
    total_rows: int


def pca_blocks(run: PcaRun) -> tuple[ReportBlock, ...]:
    """主成分的三块：压缩说明、解释方差与载荷、逐条轴的线性组合。

    Args: run。
    """
    return (_pca_columns(run), _pca_structure(run), _pca_formula(run))


def _pca_columns(run: PcaRun) -> ReportBlock:
    """原列去了哪、换来的是哪几条轴，以及这几条轴一共解释掉多少方差。

    Args: run。
    """
    covered = _cumulative(run.explained, len(run.made) - 1)
    share = "" if covered is None else f"，合计解释掉原始方差的 {_pct(covered)}"
    block = columns_block(
        BlockAt(zone="step", title="压缩说明", port=PORT, tier=TIER_SMALL),
        ColumnChange(
            added=list(run.made),
            removed=list(run.columns),
            kept=run.kept,
            reason=(
                f"在 {run.train_rows} 行训练行上把 {len(run.columns)} 列"
                f"压成 {len(run.made)} 条主成分轴{share}"
            ),
        ),
    )
    return _noted(block, (OPAQUE_NOTE, BLANK_NOTE))


def _pca_structure(run: PcaRun) -> ReportBlock:
    """碎石图与载荷热力：解释方差比、累计曲线、以及两侧的标签。

    ⚠ 标签必须与矩阵切在同一处：矩阵按上限截了而标签没截的话，热力图上每一行
    都对着错的那条轴，而图看着完全正常。
    Args: run。
    """
    rows = list(run.made[:MAX_LOADINGS])
    columns = list(run.columns[:MAX_LOADING_WIDTH])
    block = structure_block(
        BlockAt(
            zone="charts",
            title="解释方差与载荷",
            port=PORT,
            tier=TIER_LARGE,
        ),
        ModelStructure(
            loadings=[_rounded(row) for row in run.components],
            explained=_rounded(run.explained),
        ),
    )
    is_cut = len(rows) < len(run.made) or len(columns) < len(run.columns)
    extra: dict[str, Any] = {
        "loading_rows": rows,
        "loading_columns": columns,
        "cumulative": _rounded(_running(run.explained)),
        "is_loadings_cut": is_cut,
    }
    cut = CUT_NOTE.format(rows=len(rows), columns=len(columns))
    return _noted(_with(block, extra), (cut,) if is_cut else ())


def _pca_formula(run: PcaRun) -> ReportBlock:
    """逐条轴的线性组合：权重、中心点，与这一项占多少。

    Args: run。
    """
    block = fits_block(
        BlockAt(
            zone="formula",
            title="主成分的线性组合",
            port=PORT,
            tier=TIER_SMALL,
        ),
        method="pca",
        train_rows=run.train_rows,
        total_rows=run.total_rows,
        by_column=[_axis_row(run, seat) for seat in range(len(run.made))],
    )
    is_cut = len(run.columns) > MAX_TERMS
    note = TERMS_NOTE.format(terms=MAX_TERMS)
    return _noted(block, (note,) if is_cut else ())


def _axis_row(run: PcaRun, seat: int) -> Item:
    """一条轴在公式表里的那一行。

    Args: run, seat。
    """
    return {
        "key": run.made[seat],
        "params": {
            "explained": _ratio_at(run.explained, seat),
            "cumulative": _cumulative(run.explained, seat),
            "terms": _terms(run, seat),
            "terms_total": len(run.columns),
        },
        "skipped_reason": "",
    }


def _terms(run: PcaRun, seat: int) -> list[dict[str, Any]]:
    """一条轴上权重绝对值最大的前几项，按绝对值降序、同分按列序。

    ⚠ 带上每一列的中心点：少了它，公式就成了 `0.62×温度`，而真正算的是
    `0.62×(温度−27.75)`，代进去差着一个常数。
    Args: run, seat。
    """
    axis = run.components[seat] if seat < len(run.components) else ()
    ranked = sorted(
        (
            (key, float(axis[place]), _center(run.mean, place))
            for place, key in enumerate(run.columns)
            if place < len(axis)
        ),
        key=lambda item: (-abs(item[1]), item[0]),
    )
    return [
        {
            "key": key,
            "weight": round(weight, WEIGHT_DIGITS),
            "center": center,
        }
        for key, weight, center in ranked[:MAX_TERMS]
    ]


def _center(mean: Sequence[float], place: int) -> float | None:
    """一列的中心点；这一列没有中心点时给 `None` 不给 0。

    Args: mean, place。
    """
    if place >= len(mean):
        return None
    return round(float(mean[place]), WEIGHT_DIGITS)


def _ratio_at(explained: Sequence[float], seat: int) -> float | None:
    """第几条轴解释掉多少；拿不到解释方差时给 `None` 不给 0。

    Args: explained, seat。
    """
    if seat >= len(explained):
        return None
    return round(float(explained[seat]), WEIGHT_DIGITS)


def _cumulative(explained: Sequence[float], seat: int) -> float | None:
    """前若干条轴合计解释掉多少；拿不到解释方差时给 `None`。

    Args: explained, seat。
    """
    if seat < 0 or seat >= len(explained):
        return None
    total = sum(float(one) for one in explained[: seat + 1])
    return round(total, WEIGHT_DIGITS)


def _running(explained: Sequence[float]) -> list[float]:
    """累计曲线上的每一个点。

    Args: explained。
    """
    total = 0.0
    made: list[float] = []
    for one in explained:
        total += float(one)
        made.append(total)
    return made


def _rounded(values: Sequence[float]) -> list[float]:
    """一串数留到既定位数。

    Args: values。
    """
    return [round(float(value), WEIGHT_DIGITS) for value in values]


def _pct(ratio: float) -> str:
    """一个比例印成百分数。

    Args: ratio。
    """
    return f"{ratio * 100:.1f}%"


def _with(block: ReportBlock, extra: Mapping[str, Any]) -> ReportBlock:
    """给一块补上几个键。

    Args: block, extra。
    """
    return replace(block, payload={**block.payload, **extra})


def _noted(block: ReportBlock, notes: Sequence[str]) -> ReportBlock:
    """给一块挂上几句口径说明；一句都没有时原样返回。

    Args: block, notes。
    """
    if not notes:
        return block
    return replace(block, payload={**block.payload, "notes": list(notes)})
