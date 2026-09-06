"""结果面讲解的字节预算：超了按区优先级降档，每一档都留痕。

⚠ 按 **zone** 降而不是按 tier 降：先丢掉全部大数组的话，最需要解释的那类运行
（宽、长、列多）的旗舰图会第一个被斩掉，恰好是用户最想看的那张
（docs/MODELING_RESULT_VIEW_DESIGN.md §4.6）。主体图最后丢。
⚠ 每一档丢掉了谁都记进 `dropped`，界面照它在原位明示——不留痕的话，「这一步
本来就没有图」与「图被削掉了」在屏幕上长得一模一样。
"""

import json
from collections.abc import Callable, Sequence
from typing import Any

from platform_server.apps.modeling.operators import (
    TIER_LARGE,
    TIER_SCALAR,
    TIER_SMALL,
    ReportBlock,
)
from platform_server.apps.modeling.services.preview import (
    REPORT_MAX_BYTES,
    RUN_REPORT_MAX_BYTES,
)

# 降到最后一档时留给界面的说明
OVERSIZE_NOTE = "这一步的讲解太大，只留下了每一步都有的那几行"
# 一次运行的讲解预算用光之后留给界面的说明
RUN_OVERSIZE_NOTE = "本次运行的结果讲解已用满预算"
# 图上没写主次的一律当主体图：默认值站在「最后才丢」这一边
DEFAULT_PRIMARY = True


def fit_report(blocks: Sequence[ReportBlock]) -> dict[str, Any] | None:
    """把一组块压进单节点上限，回落库的那份 JSON；一块都没有回 `None`。

    回 `None` 而不是空壳：那一列可空，NULL 的旧行与「这一步没有讲解」在界面上
    本来就该长成同一个样子。
    Args: blocks。
    """
    if not blocks:
        return None
    kept = list(blocks)
    dropped: list[str] = []
    report = _rendered(kept, dropped, "")
    for level, drops in enumerate(LADDER):
        if size_of(report) <= REPORT_MAX_BYTES:
            return report
        kept, gone = _split(kept, drops)
        dropped.extend(gone)
        report = _rendered(kept, dropped, _note_at(level))
    if size_of(report) > REPORT_MAX_BYTES:
        return _bare(list(blocks), OVERSIZE_NOTE)
    return report


class RunReportBudget:
    """一次运行里全部讲解合计的字节预算。

    ⚠ 与摘要那本账**各记各的**：讲解被削不该让摘要跟着少，反过来也一样。
    """

    def __init__(self) -> None:
        self._used = 0

    def take(self, report: dict[str, Any] | None) -> dict[str, Any] | None:
        """把一份讲解压进运行级预算；装不下的换成只剩留痕的桩。

        Args: report。
        """
        if report is None:
            return None
        size = size_of(report)
        if self._used + size > RUN_REPORT_MAX_BYTES:
            return _stub(report)
        self._used += size
        return report


def size_of(report: dict[str, Any]) -> int:
    """一份讲解落库要占多少字节。两级预算都按它记账。

    Args: report。
    """
    return len(json.dumps(report, ensure_ascii=False).encode())


def _is_bulky_table(block: ReportBlock) -> bool:
    """明细表里的大数组：屏幕上最靠下，也最容易再拉一次接口拿回来。

    Args: block。
    """
    return block.tier >= TIER_LARGE and block.zone == "table"


def _is_aux_chart(block: ReportBlock) -> bool:
    """图区里的**辅**图。主体图不在其列——它最后才丢。

    Args: block。
    """
    return (
        block.tier >= TIER_LARGE
        and block.zone == "charts"
        and not _is_primary(block)
    )


def _is_small_aside(block: ReportBlock) -> bool:
    """第一区之外的**小**数组。

    ⚠ 这一档只挑 tier 1：熬到这里还没被丢的大数组正是各区的主体图，它们跟着
    最后一档一起走，别在这里连坐。
    Args: block。
    """
    return block.tier == TIER_SMALL and block.zone != "step"


def _is_beyond_the_gist(block: ReportBlock) -> bool:
    """除了第一区那几行标量，其余全丢。

    Args: block。
    """
    return not (block.zone == "step" and block.tier == TIER_SCALAR)


# 五档降级，逐档累加。⚠ 顺序即语义，别按「先丢大的」重排
LADDER: tuple[Callable[[ReportBlock], bool], ...] = (
    _is_bulky_table,
    _is_aux_chart,
    _is_small_aside,
    _is_beyond_the_gist,
)


def _is_primary(block: ReportBlock) -> bool:
    return bool(block.payload.get("is_primary", DEFAULT_PRIMARY))


def _split(
    blocks: list[ReportBlock], drops: Callable[[ReportBlock], bool]
) -> tuple[list[ReportBlock], list[str]]:
    """按一条判据把块分成留下的与丢掉的，丢掉的只回标题。

    Args: blocks, drops。
    """
    kept = [block for block in blocks if not drops(block)]
    gone = [block.title for block in blocks if drops(block)]
    return kept, gone


def _note_at(level: int) -> str:
    """降到最后一档才有话说，前几档由 `dropped` 自己在原位说明。

    Args: level。
    """
    return OVERSIZE_NOTE if level == len(LADDER) - 1 else ""


def _rendered(
    blocks: list[ReportBlock], dropped: list[str], note: str
) -> dict[str, Any]:
    """摆成落库的形状。三个键**恒在**：缺键与空值在前端读起来是两回事。

    Args: blocks, dropped, note。
    """
    return {
        "blocks": [_as_json(block) for block in blocks],
        "dropped": list(dropped),
        "note": note,
    }


def _bare(blocks: list[ReportBlock], note: str) -> dict[str, Any]:
    """一块都留不下时的形状：只剩谁被丢了，与一句为什么。

    Args: blocks, note。
    """
    return {
        "blocks": [],
        "dropped": [block.title for block in blocks],
        "note": note,
    }


def _stub(report: dict[str, Any]) -> dict[str, Any]:
    """运行级预算用光时的桩：块全丢，留痕与说明还在。

    Args: report。
    """
    blocks: Sequence[Any] = report.get("blocks") or ()
    titles = [str(block.get("title", "")) for block in blocks]
    return {
        "blocks": [],
        "dropped": list(report.get("dropped") or ()) + titles,
        "note": RUN_OVERSIZE_NOTE,
    }


def _as_json(block: ReportBlock) -> dict[str, Any]:
    return {
        "kind": block.kind,
        "zone": block.zone,
        "port": block.port,
        "title": block.title,
        "tier": block.tier,
        "payload": block.payload,
    }
