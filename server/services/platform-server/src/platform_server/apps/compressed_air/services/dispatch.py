"""在阜阳空压站已标定的流量范围内计算稳态推荐。"""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from itertools import combinations, pairwise, product
from math import isfinite

from platform_server.apps.compressed_air.models import Curves, Knot


@dataclass(frozen=True)
class Recommendation:
    """相同目标流量下功率最低的机组组合。"""

    machines: tuple[int, ...]
    power_kw: float


TOLERANCE = 1e-8


def recommend(
    demand: float, available: Sequence[int], curves: Curves
) -> Recommendation | None:
    """枚举可用且已标定的机组。Args: demand, available, curves。"""
    if not isfinite(demand) or demand < 0:
        return None
    if demand == 0:
        return Recommendation((), 0.0)
    usable = tuple(i for i in available if curves.get(i))
    options = (
        Recommendation(group, power)
        for size in range(1, len(usable) + 1)
        for group in combinations(usable, size)
        if (power := _group_power(tuple(curves[i] for i in group), demand))
        is not None
    )
    return min(options, key=lambda item: item.power_kw, default=None)


def _group_power(
    curves: tuple[tuple[Knot, ...], ...], demand: float
) -> float | None:
    """为指定组合查找最低稳态功率。Args: curves, demand。"""
    if (
        not sum(c[0].flow for c in curves) - TOLERANCE
        <= demand
        <= sum(c[-1].flow for c in curves) + TOLERANCE
    ):
        return None
    return min(_vertex_powers(curves, demand), default=None)


def _vertex_powers(
    curves: tuple[tuple[Knot, ...], ...], demand: float
) -> Iterator[float]:
    """遍历分段线性可行域的顶点。Args: curves, demand。"""
    for index, free in enumerate(curves):
        for fixed in product(*curves[:index], *curves[index + 1 :]):
            left = demand - sum(knot.flow for knot in fixed)
            power = _interpolate(free, left)
            if power is not None:
                yield power + sum(knot.power for knot in fixed)


def _interpolate(curve: tuple[Knot, ...], flow: float) -> float | None:
    """在已标定流量内插值。Args: curve, flow。"""
    if abs(flow - curve[0].flow) <= TOLERANCE:
        return curve[0].power
    if abs(flow - curve[-1].flow) <= TOLERANCE:
        return curve[-1].power
    for lower, upper in pairwise(curve):
        if lower.flow <= flow <= upper.flow:
            fraction = (flow - lower.flow) / (upper.flow - lower.flow)
            return lower.power + fraction * (upper.power - lower.power)
    return None
