"""滞后与滚动那两步的结果面算料：新增列、空出来的行、窗口示意与分母。

两个都只加列不改行，讲的话因此同构；两个也都让整条流水线不可上线，那句话必须
在结果面上就说出来（docs/MODELING_RESULT_VIEW_DESIGN.md §5-14、§5-15）。
⚠ `alerts` 与 `notes` 是两档：会导致**错误结论**的那几条走 `alerts`，界面整条
摆出来；其余口径说明走 `notes`，收在小问号里（规格 §11 的 R-24）。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace

from platform_server.apps.modeling.operators.reporting import (
    MAX_BIN_COLUMNS,
    MAX_ROW_COLUMNS,
    MAX_SEGMENTS,
    NOTE_ALERT,
    NOTE_HINT,
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    BlockAt,
    ColumnChange,
    Item,
    ReportBlock,
    RowCounts,
    TimeAxis,
    annotated,
    axis_block,
    bins_block,
    columns_block,
    rows_block,
)
from platform_server.apps.modeling.operators.steps import (
    column_bins,
    ratio_of,
    spread_of,
)

# 两个算子各只有一路输出，讲解全挂在它上面
PORT = "frame"

# 这两个算子推理时拿不到历史行
SERVING_ALERT = (
    "这一步让整条流水线不可上线：推理时只有一行，"
    "算不出「前几期的值」与「近几期的统计量」，发布那一步会拦下来"
)
# 滚动统计的分母逐行不同——规格 §11 的 R-24 点名的那一条
DENOMINATOR_ALERT = (
    "窗口里的空值先被滤掉再折，所以分母逐行不同："
    "「{key}」有 {partial} 行的窗口没填满（最少的一行只用了 {fewest} 个点），"
    "它们与用满 {window} 个点算出来的结果在图上长得一模一样"
)
# 行序不是时刻
ORDER_NOTE = (
    "按帧的行序往前数，不按时刻：中间插了会改行序的算子（排序、随机切分）"
    "之后这几列整片是错的，图校验也拦不住这一条"
)
# 开头那几行的空值不许当 0 读
ZERO_FILL_NOTE = (
    "开头那几行是空值不是 0：填 0 会把「还没有历史」说成「历史上是 0」，"
    "而模型学到的是后者"
)
# 窗口含不含当前行是最容易记反的一条
WINDOW_NOTE = (
    "窗口连当前行一起数：窗口 {window} 就是「当前行 + 前 {before} 行」"
)
# 前几行本来就没有输出，不该混进分布里
FULL_WINDOW_NOTE = (
    "只数了窗口已满的那些行：开头 {head} 行本来就给空值，不进这张图"
)
# 档位太多时示意图只画得下前几条
CUT_NOTE = "档位太多，示意图只画得下前 {kept} 个"


@dataclass(frozen=True)
class LagRun:
    """滞后特征这一步实际做了什么，`lag_blocks` 照它讲。"""

    #: 造出来的每一列与它滞后几期
    made: tuple[tuple[str, int], ...]
    sources: tuple[str, ...]
    #: 去重排序之后真正用上的档位
    lags: tuple[int, ...]
    #: 参数里写了几个档位（含重复）。与 `lags` 对不上时讲解要说出来
    configured: int
    kept: int
    rows: int


@dataclass(frozen=True)
class RollingRun:
    """滚动统计这一步实际做了什么，`rolling_blocks` 照它讲。"""

    #: 造出来的每一列与它的原列
    made: tuple[tuple[str, str], ...]
    sources: tuple[str, ...]
    stats: tuple[str, ...]
    window: int
    kept: int
    rows: int
    #: 每个原列逐行的有效样本数，只数窗口已满的那些行
    counts: Mapping[str, Sequence[int]]


def valid_counts(values: Sequence[float | None], window: int) -> list[int]:
    """逐行的有效样本数 m_i，只数窗口已满的那些行。

    ⚠ 滚动统计的分母就是它，而它逐行不同：窗口里的空值先被滤掉再折
    （规格 §11 的 R-24）。
    Args: values, window。
    """
    made: list[int] = []
    present = 0
    for seat, value in enumerate(values):
        if value is not None:
            present += 1
        gone = seat - window
        if gone >= 0 and values[gone] is not None:
            present -= 1
        if seat + 1 >= window:
            made.append(present)
    return made


def lag_blocks(run: LagRun) -> tuple[ReportBlock, ...]:
    """滞后特征的三块：新增列与实际档位、头部空行、窗口示意。

    Args: run。
    """
    return (_lag_columns(run), _lag_rows(run), _lag_axis(run))


def rolling_blocks(run: RollingRun) -> tuple[ReportBlock, ...]:
    """滚动统计的四块：新增列、空出来的行、逐行有效样本数、窗口示意。

    Args: run。
    """
    return (
        _rolling_columns(run),
        _rolling_rows(run),
        _rolling_bins(run),
        _rolling_axis(run),
    )


def _lag_columns(run: LagRun) -> ReportBlock:
    """造了哪几列、实际用上了哪几个档位。

    Args: run。
    """
    listed = "、".join(str(lag) for lag in run.lags)
    block = columns_block(
        BlockAt(
            zone="step", title="新增列与实际档位", port=PORT, tier=TIER_SMALL
        ),
        ColumnChange(
            added=[key for key, _ in run.made],
            kept=run.kept,
            reason=(
                f"{len(run.sources)} 列 × {len(run.lags)} 个档位造出 "
                f"{len(run.made)} 列；参数里写了 {run.configured} 个档位，"
                f"去重排序之后是 {listed}"
            ),
        ),
    )
    return _hinted(_alerted(block, (SERVING_ALERT,)), (ORDER_NOTE,))


def _lag_rows(run: LagRun) -> ReportBlock:
    """每一列开头有多少行是空的——那是没有历史可搬的那几行。

    Args: run。
    """
    ranked = sorted(
        (
            {
                "key": key,
                "count": min(lag, run.rows),
                "ratio": ratio_of(min(lag, run.rows), run.rows),
            }
            for key, lag in run.made
        ),
        key=lambda item: (-int(str(item["count"])), str(item["key"])),
    )
    block = rows_block(
        BlockAt(zone="step", title="头部空行", port=PORT, tier=TIER_SCALAR),
        RowCounts(before=run.rows, after=run.rows),
        by_column=ranked[:MAX_ROW_COLUMNS],
    )
    return _hinted(block, (ZERO_FILL_NOTE,))


def _lag_axis(run: LagRun) -> ReportBlock:
    """窗口示意：每个档位各去第几行取的值。

    Args: run。
    """
    kept = run.lags[: MAX_SEGMENTS - 1]
    latest = max(kept) if kept else 0
    segments: list[Item] = [
        {
            "label": "当前行",
            "tone": "primary",
            "since": latest,
            "until": latest + 1,
            "lag": 0,
        }
    ]
    segments.extend(
        {
            "label": f"滞后 {lag} 期取的那一行",
            "tone": "secondary",
            "since": latest - lag,
            "until": latest - lag + 1,
            "lag": lag,
        }
        for lag in kept
    )
    block = _indexed(
        axis_block(
            BlockAt(
                zone="charts",
                title="窗口示意",
                port=PORT,
                tier=TIER_SMALL,
                is_primary=True,
            ),
            TimeAxis(segments=segments),
        )
    )
    cut = CUT_NOTE.format(kept=len(kept))
    return _hinted(block, () if len(kept) == len(run.lags) else (cut,))


def _rolling_columns(run: RollingRun) -> ReportBlock:
    """造了哪几列、窗口多宽。

    Args: run。
    """
    block = columns_block(
        BlockAt(zone="step", title="新增列", port=PORT, tier=TIER_SMALL),
        ColumnChange(
            added=[key for key, _ in run.made],
            kept=run.kept,
            reason=(
                f"{len(run.sources)} 列 × {len(run.stats)} 个统计量造出 "
                f"{len(run.made)} 列，窗口 {run.window} 行"
            ),
        ),
    )
    hinted = _hinted(
        block,
        (
            WINDOW_NOTE.format(window=run.window, before=run.window - 1),
            ORDER_NOTE,
        ),
    )
    return _alerted(hinted, (SERVING_ALERT,))


def _rolling_rows(run: RollingRun) -> ReportBlock:
    """每一列空掉多少行：窗口没满的那几行，加上窗口里一个数都没有的那些行。

    Args: run。
    """
    head = min(run.window - 1, run.rows)
    ranked = sorted(
        (_rolling_row(run, key, source, head) for key, source in run.made),
        key=lambda item: (-int(str(item["count"])), str(item["key"])),
    )
    block = rows_block(
        BlockAt(zone="step", title="空掉的行", port=PORT, tier=TIER_SCALAR),
        RowCounts(before=run.rows, after=run.rows),
        by_column=ranked[:MAX_ROW_COLUMNS],
    )
    return _alerted(_hinted(block, (ZERO_FILL_NOTE,)), _denominator(run))


def _rolling_row(run: RollingRun, key: str, source: str, head: int) -> Item:
    """一列在空行账里的那一行。

    ⚠ 两笔分开记：窗口没满是「这一步必然的头部空档」，窗口里全空是「上游那一段
    压根没有数」，两者要用户做的事完全不同。
    Args: run, key, source, head。
    """
    empty = sum(1 for count in run.counts.get(source, ()) if count == 0)
    return {
        "key": key,
        "count": head + empty,
        "ratio": ratio_of(head + empty, run.rows),
        "head": head,
        "empty": empty,
    }


def _denominator(run: RollingRun) -> tuple[str, ...]:
    """分母逐行不同那条告警；这一趟没有一行是半满窗口时一个字都不说。

    Args: run。
    """
    worst = ""
    partial = 0
    for source in run.sources:
        counted = [
            count for count in run.counts.get(source, ()) if count < run.window
        ]
        if len(counted) > partial:
            worst = source
            partial = len(counted)
    if not worst:
        return ()
    fewest = min(run.counts.get(worst, ()) or (0,))
    return (
        DENOMINATOR_ALERT.format(
            key=worst, partial=partial, fewest=fewest, window=run.window
        ),
    )


def _rolling_bins(run: RollingRun) -> ReportBlock:
    """逐行有效样本数的分布，满窗口那一处画一条线。

    Args: run。
    """
    head = min(run.window - 1, run.rows)
    block = bins_block(
        BlockAt(
            zone="charts",
            title="逐行有效样本数",
            port=PORT,
            tier=TIER_LARGE,
            is_primary=True,
        ),
        [
            column_bins(
                source,
                spread_of(
                    [float(count) for count in run.counts.get(source, ())],
                    low=0.0,
                    high=float(run.window),
                ),
                off_label="窗口没满的行",
                marks=(
                    {
                        "at": float(run.window),
                        "label": "窗口填满",
                        "intent": "info",
                    },
                ),
            )
            for source in run.sources[:MAX_BIN_COLUMNS]
        ],
    )
    return _hinted(block, (FULL_WINDOW_NOTE.format(head=head),))


def _rolling_axis(run: RollingRun) -> ReportBlock:
    """窗口示意：这一格算的是哪几行。

    Args: run。
    """
    segments: list[Item] = [
        {
            "label": f"窗口 {run.window} 行",
            "tone": "primary",
            "since": 0,
            "until": run.window,
            "lag": run.window - 1,
        },
        {
            "label": "当前行",
            "tone": "secondary",
            "since": run.window - 1,
            "until": run.window,
            "lag": 0,
        },
    ]
    block = _indexed(
        axis_block(
            BlockAt(
                zone="charts",
                title="窗口示意",
                port=PORT,
                tier=TIER_SMALL,
                is_primary=False,
            ),
            TimeAxis(segments=segments),
        )
    )
    return _hinted(
        block,
        (WINDOW_NOTE.format(window=run.window, before=run.window - 1),),
    )


def _indexed(block: ReportBlock) -> ReportBlock:
    """标成按**行序**量的一条轴，不是按时刻。

    ⚠ 不标的话界面会把 0、1、2 当毫秒时刻去印，画出来是 1970 年的那一瞬间。
    Args: block。
    """
    return replace(block, payload={**block.payload, "scale": "index"})


def _hinted(block: ReportBlock, notes: Sequence[str]) -> ReportBlock:
    """给一块挂上几句口径说明，收在小问号里。

    Args: block, notes。
    """
    return annotated(block, NOTE_HINT, notes)


def _alerted(block: ReportBlock, alerts: Sequence[str]) -> ReportBlock:
    """给一块挂上必须整条摆出来的告警。

    ⚠ 这一档说的是会让人**读出错误结论**的事，收进小问号里等于没说
    （规格 §11 的 R-24）。
    Args: block, alerts。
    """
    return annotated(block, NOTE_ALERT, alerts)
