"""出厂预设的库公式。由 `scripts/seed.py` 补进库，**只补缺不覆盖**。

⚠ 预设是**代码常量，没有任何运行期信号**：改坏一条，在有人从插入面板里选中它
并保存失败之前不会有任何东西抱怨。故单元用例逐条跑真校验
（docs/DATASET_DESIGN.md §5.11）。
⚠ 折标煤系数按 GB/T 2589 的等价值口径，**本来就是要按地区与年份改的**：直接
改这里的条目，全部引用它的台账列在下一次重算时跟上。
"""

from platform_server.apps.dataset.formula import (
    PARAM_VALUE,
    FxEntry,
    FxParam,
)

# 电力等价值折标煤系数，kgce/kWh
_COAL_PER_KWH = 0.1229
# 天然气折标煤系数，kgce/m³
_COAL_PER_CUBIC_METER = 1.33

BUILTIN_FORMULAS: tuple[FxEntry, ...] = (
    FxEntry(
        code="环比增长率",
        name="环比增长率(%)",
        category="trend",
        expression="({本期} - PREV({本期}, 1)) / PREV({本期}, 1) * 100",
        params=(FxParam(name="本期", label="本期值"),),
        description="本期与上一期相比涨跌了多少",
    ),
    FxEntry(
        code="同比增长率",
        name="同比增长率(%)",
        category="trend",
        expression=(
            "({本期} - PREV({本期}, {周期数})) / PREV({本期}, {周期数}) * 100"
        ),
        params=(
            FxParam(name="本期", label="本期值"),
            FxParam(
                name="周期数",
                kind=PARAM_VALUE,
                label="回溯几期",
                # ⚠ 数的是**台账的期数**不是时间：月报台账填 12，小时台账填 24
                hint="按台账周期数，月报填 12，小时表填 24",
                default=12,
            ),
        ),
        description="与去年同期相比涨跌了多少",
    ),
    FxEntry(
        code="增量",
        name="本期增量",
        category="trend",
        expression="{累计值} - PREV({累计值}, 1)",
        params=(FxParam(name="累计值", label="累计读数"),),
        description="表计累计读数折成本期用量",
    ),
    FxEntry(
        code="差值",
        name="两列之差",
        category="basic",
        expression="{被减数} - {减数}",
        params=(FxParam(name="被减数"), FxParam(name="减数")),
        description="进水减出水这类净值",
    ),
    FxEntry(
        code="占比",
        name="占比(%)",
        category="basic",
        expression="{部分} / {整体} * 100",
        params=(
            FxParam(name="部分", label="分子（部分）"),
            FxParam(
                name="整体",
                kind=PARAM_VALUE,
                label="分母（整体）",
                default=1,
            ),
        ),
        description="部分占整体的百分比",
    ),
    FxEntry(
        code="占全表比例",
        name="占全表合计的比例(%)",
        category="basic",
        expression="{值} / SUM_ALL({值}) * 100",
        params=(FxParam(name="值", label="要摊分的列"),),
        description="这一行占整列合计的比例",
    ),
    FxEntry(
        code="安全除",
        name="安全除(分母为空或 0 时取兜底)",
        category="basic",
        # ⚠ 写成 `IFS` 而不是 `IF(OR(ISBLANK(…), … == 0), …)`：两种写法在
        # Kleene 逻辑下等价，但 `IFS` 把「空」与「零」两档摆在明面上
        expression=(
            "IFS(ISBLANK({分母}), {兜底}, {分母} == 0, {兜底}, "
            "{分子} / {分母})"
        ),
        params=(
            FxParam(name="分子", kind=PARAM_VALUE, default=0),
            FxParam(name="分母", kind=PARAM_VALUE, default=1),
            FxParam(name="兜底", kind=PARAM_VALUE, default=0),
        ),
        description="分母为空或为 0 时取兜底值，不让整列变空",
    ),
    FxEntry(
        code="单位产品能耗",
        name="单位产品能耗",
        category="energy",
        expression="{能耗} / {产量}",
        params=(FxParam(name="能耗"), FxParam(name="产量")),
        description="每单位产量耗掉多少能",
    ),
    FxEntry(
        code="电力折标煤",
        name="电力折标煤(kgce)",
        category="energy",
        expression=f"{{电量}} * {_COAL_PER_KWH}",
        params=(FxParam(name="电量", label="耗电量(kWh)"),),
        description="按 GB/T 2589 等价值口径折标准煤",
    ),
    FxEntry(
        code="天然气折标煤",
        name="天然气折标煤(kgce)",
        category="energy",
        expression=f"{{气量}} * {_COAL_PER_CUBIC_METER}",
        params=(FxParam(name="气量", label="天然气用量(m³)"),),
        description="按 GB/T 2589 等价值口径折标准煤",
    ),
    FxEntry(
        code="滑动均值",
        name="滑动均值",
        category="stat",
        expression="AVG_OVER({值}, {窗口})",
        params=(
            FxParam(name="值"),
            FxParam(
                name="窗口", kind=PARAM_VALUE, label="时间窗", default="24h"
            ),
        ),
        description="一段时间窗内的平均值，含当前行",
    ),
    FxEntry(
        code="滚动合计",
        name="滚动合计",
        category="stat",
        expression="SUM_OVER({值}, {窗口})",
        params=(
            FxParam(name="值"),
            FxParam(
                name="窗口", kind=PARAM_VALUE, label="时间窗", default="24h"
            ),
        ),
        description="一段时间窗内的合计，含当前行",
    ),
    FxEntry(
        code="极差归一化",
        name="极差归一化(0~1)",
        category="stat",
        expression=("({值} - MIN_ALL({值})) / (MAX_ALL({值}) - MIN_ALL({值}))"),
        params=(FxParam(name="值", label="要归一化的列"),),
        description="把整列压到 0~1 之间",
    ),
    FxEntry(
        code="达标判定",
        name="达标判定(1/0)",
        category="stat",
        expression="IF({实测} <= {限值}, 1, 0)",
        params=(
            FxParam(name="实测"),
            FxParam(name="限值", kind=PARAM_VALUE, default=0),
        ),
        description="不超过限值记 1，超了记 0",
    ),
    FxEntry(
        code="窗口全零则取兜底",
        name="近一段时间全为 0 时改取兜底值",
        category="stat",
        # ⚠ 空窗口上 `ALL_ZERO_OVER` 给的是**空不是真**：「全是 0」与「什么都
        # 没有」不是一回事，混为一谈会把一张刚建的空表送进归零那一支
        expression="IF(ALL_ZERO_OVER({判定列}, {窗口}), {兜底}, {正常值})",
        params=(
            FxParam(name="判定列"),
            FxParam(
                name="窗口", kind=PARAM_VALUE, label="时间窗", default="12mo"
            ),
            FxParam(name="兜底", kind=PARAM_VALUE, default=0),
            FxParam(name="正常值", kind=PARAM_VALUE, default=0),
        ),
        description="近一段时间全为 0 时改取兜底值",
    ),
)
