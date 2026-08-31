"""点位召回：从一批候选里挑出最像用户要的那几个。

**为什么要在助手侧做这件事**：后端的 `q` 只对名字与编码做子串匹配，而且永远是
顺序扫描；点位表既没有描述、也没有分组或设备归属。真正能用的信号只有三样，
按可靠度排：

  `name`  中文全称，如「1号机组出口温度」——**最可靠**
  `code`  工业缩写编码，如 `K1_TMT_HOT_T_PI`——要按缩写表解读
  `unit`  单位，用来交叉验证（℃ 配温度槽，kPa 配压力槽）

⚠ **`address` 基本没有语义**：真实现场的地址空间里大部分节点是 `i=2253` 这样
的裸数字标识，那是 OPC UA 的标准诊断节点，与业务毫无关系。所以这里一个字都不
看它——按它猜业务含义会稳定地猜错。

⚠ 打分**不做取舍，只做排序**。最终选哪一个由模型定，因为只有它知道用户这句话
的上下文。这里把「为什么它排在这」也一并交出去，模型据此判断该不该信。
"""

import re
from dataclasses import dataclass

# 工业测点编码里公认的缩写。⚠ 这张表是这套召回**唯一**的领域知识来源，
# 加一条比改打分公式有用得多
ABBREVIATIONS: dict[str, tuple[str, ...]] = {
    "TT": ("温度",),
    "TMT": ("温度",),
    "TE": ("温度",),
    "PT": ("压力",),
    "PE": ("压力",),
    "DP": ("压差", "差压"),
    "FT": ("流量",),
    "FE": ("流量",),
    "LT": ("液位", "料位"),
    "AT": ("分析", "浓度"),
    "SP": ("设定值", "设定"),
    "PV": ("测量值", "实测"),
    "MV": ("输出", "开度"),
    "RUN": ("运行", "启停"),
    "ST": ("状态",),
    "ALM": ("报警", "告警"),
    "FREQ": ("频率",),
    "HZ": ("频率",),
    "KW": ("功率",),
    "POW": ("功率",),
    "KWH": ("电量", "耗电"),
    "COOL": ("冷", "制冷"),
    "HOT": ("热", "供热"),
    "IN": ("进口", "入口"),
    "OUT": ("出口",),
    "FILTER": ("过滤器",),
    "PUMP": ("泵",),
    "FAN": ("风机",),
    "VALVE": ("阀",),
}

# 单位 → 它量的是什么。用来做交叉验证：名字像温度而单位是 kPa，多半不是它
UNIT_MEANINGS: dict[str, tuple[str, ...]] = {
    "℃": ("温度",),
    "°C": ("温度",),
    "K": ("温度",),
    "kPa": ("压力", "压差", "差压"),
    "MPa": ("压力",),
    "Pa": ("压力", "压差", "差压"),
    "bar": ("压力",),
    "m3/h": ("流量",),
    "t/h": ("流量",),
    "L/min": ("流量",),
    "m": ("液位", "料位"),
    "%": ("开度", "浓度", "液位"),
    "Hz": ("频率",),
    "kW": ("功率",),
    "kWh": ("电量", "耗电"),
    "A": ("电流",),
    "V": ("电压",),
}

# 编码里的分段符
_SPLIT = re.compile(r"[^A-Za-z0-9]+")
# 一个词至少这么长才拿去做子串匹配，否则「1」会命中一切
_MIN_TOKEN = 2


@dataclass(frozen=True)
class PointCandidate:
    """一个候选点位，只带召回用得上的那几样。"""

    node_key: str
    code: str
    name: str
    unit: str | None
    data_type: str


@dataclass(frozen=True)
class ScoredPoint:
    """一个候选与它的得分。`why` 是给模型看的一句话。"""

    point: PointCandidate
    score: float
    why: str


def expand_code(code: str) -> tuple[str, ...]:
    """把编码里的缩写摊成中文词。

    `K1_TMT_HOT_T_PI` → ('温度', '热', '供热')。认不出的段原样保留，
    它们往往是机组号或自定义标识，仍能参与子串匹配。

    Args: code。
    """
    found: list[str] = []
    for part in _SPLIT.split(code.upper()):
        if not part:
            continue
        found.extend(ABBREVIATIONS.get(part, (part,)))
    return tuple(found)


def unit_meanings(unit: str | None) -> tuple[str, ...]:
    """这个单位量的是什么。认不出给空。

    Args: unit。
    """
    if unit is None:
        return ()
    return UNIT_MEANINGS.get(unit.strip(), ())


def score_point(
    point: PointCandidate,
    *,
    keyword: str,
    expect_unit: str | None = None,
    expect_type: str | None = None,
) -> ScoredPoint:
    """给一个候选打分。分数只用于排序，不构成取舍。

    Args: point, keyword, expect_unit, expect_type。
    """
    marks: list[tuple[float, str]] = []
    marks.extend(_name_marks(point, keyword))
    marks.extend(_code_marks(point, keyword))
    marks.extend(_unit_marks(point, keyword, expect_unit))
    if expect_type is not None and point.data_type == expect_type:
        marks.append((0.5, f"类型是 {expect_type}"))
    total = sum(weight for weight, _ in marks)
    why = "；".join(note for _, note in marks) or "没有明显对得上的地方"
    return ScoredPoint(point=point, score=round(total, 3), why=why)


def rank(
    points: list[PointCandidate],
    *,
    keyword: str,
    limit: int = 20,
    expect_unit: str | None = None,
    expect_type: str | None = None,
) -> list[ScoredPoint]:
    """给一批候选排序，取前 `limit` 个。

    ⚠ 得分为 0 的一律不返回：把毫无关系的点位摆进候选，模型会以为「就这些了」
    然后从里面硬挑一个——那比返回空表难查得多。

    Args: points, keyword, limit, expect_unit, expect_type。
    """
    scored = [
        score_point(
            point,
            keyword=keyword,
            expect_unit=expect_unit,
            expect_type=expect_type,
        )
        for point in points
    ]
    hits = [one for one in scored if one.score > 0]
    hits.sort(key=lambda one: (-one.score, one.point.node_key))
    return hits[:limit]


def _name_marks(point: PointCandidate, keyword: str) -> list[tuple[float, str]]:
    """名字上的命中。最可靠的一路，权重也最高。"""
    name = point.name
    if not name or not keyword:
        return []
    if keyword == name:
        return [(5.0, "名字完全一样")]
    if keyword in name:
        return [(3.0, "名字里含这个词")]
    shared = _shared_terms(keyword, name)
    if shared:
        return [(1.5 * len(shared), f"名字里有 {'、'.join(shared)}")]
    return []


def _code_marks(point: PointCandidate, keyword: str) -> list[tuple[float, str]]:
    """编码上的命中。要先把缩写摊成中文才比得了。"""
    terms = [term for term in expand_code(point.code) if term in keyword]
    if not terms:
        return []
    return [(1.0 * len(terms), f"编码解读出 {'、'.join(sorted(set(terms)))}")]


def _unit_marks(
    point: PointCandidate, keyword: str, expect_unit: str | None
) -> list[tuple[float, str]]:
    """单位上的交叉验证。它证不了「是」，但能证「不是」。"""
    found: list[tuple[float, str]] = []
    if expect_unit is not None and point.unit == expect_unit:
        found.append((1.0, f"单位是 {expect_unit}"))
    meanings = [one for one in unit_meanings(point.unit) if one in keyword]
    if meanings:
        found.append((1.0, f"单位对得上{meanings[0]}"))
    return found


def _shared_terms(keyword: str, name: str) -> list[str]:
    """两串里共有的词。中文没有空格，按二字窗口切。"""
    windows = {
        keyword[index : index + _MIN_TOKEN]
        for index in range(len(keyword) - _MIN_TOKEN + 1)
    }
    return sorted(one for one in windows if one in name)
