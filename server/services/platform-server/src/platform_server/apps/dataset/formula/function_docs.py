"""函数目录里每个函数的说明、签名与样例。

⚠ **元数不在这里手写**：`catalog.build_catalog()` 从 `signatures` 注入。前端按
`min_args` 生成模板空位数，这里手抄错一个数，症状是「点一下函数就报元数不对」
——在界面上几乎归因不到（docs/DATASET_DESIGN.md §5.3）。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FunctionDoc:
    """一个函数在面板里的说明。`args` 是各参数的中文名，用来标模板空位。"""

    name: str
    category: str
    signature: str
    description: str
    example: str
    args: tuple[str, ...]


FUNCTION_DOCS: tuple[FunctionDoc, ...] = (
    # 数学
    FunctionDoc(
        name="ABS",
        category="math",
        signature="ABS(x)",
        description="绝对值",
        example="ABS({差值})",
        args=("x",),
    ),
    FunctionDoc(
        name="ROUND",
        category="math",
        signature="ROUND(x, n)",
        description="四舍五入到 n 位小数，n 省略即取整",
        example="ROUND({流量}, 2)",
        args=("x", "小数位"),
    ),
    FunctionDoc(
        name="CEIL",
        category="math",
        signature="CEIL(x)",
        description="向上取整",
        example="CEIL({数量})",
        args=("x",),
    ),
    FunctionDoc(
        name="FLOOR",
        category="math",
        signature="FLOOR(x)",
        description="向下取整",
        example="FLOOR({数量})",
        args=("x",),
    ),
    FunctionDoc(
        name="TRUNC",
        category="math",
        signature="TRUNC(x)",
        description="直接截掉小数部分（向零取整，-2.7 得 -2）",
        example="TRUNC({时长})",
        args=("x",),
    ),
    FunctionDoc(
        name="SQRT",
        category="math",
        signature="SQRT(x)",
        description="平方根；负数返回空",
        example="SQRT({面积})",
        args=("x",),
    ),
    FunctionDoc(
        name="POW",
        category="math",
        signature="POW(x, y)",
        description="x 的 y 次方",
        example="POW({边长}, 2)",
        args=("底数", "指数"),
    ),
    FunctionDoc(
        name="SIGN",
        category="math",
        signature="SIGN(x)",
        description="取符号：正 1 / 负 -1 / 零 0",
        example="SIGN({偏差})",
        args=("x",),
    ),
    FunctionDoc(
        name="MOD",
        category="math",
        signature="MOD(x, 除数)",
        description=(
            "取余；除数为 0 返回空。符号随**除数**（与电子表格的 MOD 一致，-1 "
            "除以 3 得 2）"
        ),
        example="MOD({累计分钟}, 60)",
        args=("x", "除数"),
    ),
    FunctionDoc(
        name="CLAMP",
        category="math",
        signature="CLAMP(x, 下限, 上限)",
        description="把 x 夹在上下限之间",
        example="CLAMP({开度}, 0, 100)",
        args=("x", "下限", "上限"),
    ),
    FunctionDoc(
        name="HYPOT",
        category="math",
        signature="HYPOT(x, y)",
        description="两直角边求斜边，即 √(x²+y²)；算矢量合成很顺手",
        example="HYPOT({X向振动}, {Y向振动})",
        args=("x", "y"),
    ),
    # 对数与指数
    FunctionDoc(
        name="LN",
        category="explog",
        signature="LN(x)",
        description="自然对数（以 e 为底）；x ≤ 0 返回空",
        example="LN({浓度})",
        args=("x",),
    ),
    FunctionDoc(
        name="LOG10",
        category="explog",
        signature="LOG10(x)",
        description="常用对数（以 10 为底）；算 pH、分贝这类用它",
        example="-LOG10({氢离子浓度})",
        args=("x",),
    ),
    FunctionDoc(
        name="LOG2",
        category="explog",
        signature="LOG2(x)",
        description="以 2 为底的对数",
        example="LOG2({倍数})",
        args=("x",),
    ),
    FunctionDoc(
        name="LOG",
        category="explog",
        signature="LOG(x, 底数)",
        description=(
            "指定底的对数。**只给一个参数时取自然对数**（工程里 log 常指 ln）"
            "；要十进制请明确用 LOG10"
        ),
        example="LOG({值}, 2)",
        args=("x", "底数"),
    ),
    FunctionDoc(
        name="EXP",
        category="explog",
        signature="EXP(x)",
        description="e 的 x 次方；结果超出可表示范围返回空",
        example="EXP({指数})",
        args=("x",),
    ),
    # 三角函数
    FunctionDoc(
        name="SIN",
        category="trig",
        signature="SIN(弧度)",
        description="正弦。参数是**弧度**——手上是角度请套 RADIANS",
        example="SIN(RADIANS({角度}))",
        args=("弧度",),
    ),
    FunctionDoc(
        name="COS",
        category="trig",
        signature="COS(弧度)",
        description="余弦（弧度制）。功率因数角换算常用",
        example="COS(RADIANS({相位角}))",
        args=("弧度",),
    ),
    FunctionDoc(
        name="TAN",
        category="trig",
        signature="TAN(弧度)",
        description="正切（弧度制）",
        example="TAN(RADIANS({倾角}))",
        args=("弧度",),
    ),
    FunctionDoc(
        name="ASIN",
        category="trig",
        signature="ASIN(x)",
        description="反正弦，返回弧度；|x| > 1 返回空",
        example="DEGREES(ASIN({比值}))",
        args=("x",),
    ),
    FunctionDoc(
        name="ACOS",
        category="trig",
        signature="ACOS(x)",
        description="反余弦，返回弧度；|x| > 1 返回空。由功率因数反求相位角",
        example="DEGREES(ACOS({功率因数}))",
        args=("x",),
    ),
    FunctionDoc(
        name="ATAN",
        category="trig",
        signature="ATAN(x)",
        description="反正切，返回弧度",
        example="DEGREES(ATAN({斜率}))",
        args=("x",),
    ),
    FunctionDoc(
        name="ATAN2",
        category="trig",
        signature="ATAN2(y, x)",
        description=(
            "由 (x, y) 求方位角（弧度），x 为 0 也能算——比 ATAN(y/x) 稳"
        ),
        example="DEGREES(ATAN2({北向}, {东向}))",
        args=("y", "x"),
    ),
    FunctionDoc(
        name="SINH",
        category="trig",
        signature="SINH(x)",
        description="双曲正弦",
        example="SINH({x})",
        args=("x",),
    ),
    FunctionDoc(
        name="COSH",
        category="trig",
        signature="COSH(x)",
        description="双曲余弦（悬链线、传热计算里出现）",
        example="COSH({x})",
        args=("x",),
    ),
    FunctionDoc(
        name="TANH",
        category="trig",
        signature="TANH(x)",
        description="双曲正切；肋片效率这类公式里用",
        example="TANH({mL})",
        args=("x",),
    ),
    FunctionDoc(
        name="DEGREES",
        category="trig",
        signature="DEGREES(弧度)",
        description="弧度换成角度",
        example="DEGREES(ATAN({斜率}))",
        args=("弧度",),
    ),
    FunctionDoc(
        name="RADIANS",
        category="trig",
        signature="RADIANS(角度)",
        description="角度换成弧度（三角函数的入口）",
        example="SIN(RADIANS({角度}))",
        args=("角度",),
    ),
    # 常量
    FunctionDoc(
        name="PI",
        category="const",
        signature="PI()",
        description="圆周率。写成带括号的 PI()——光秃秃的 PI 会被当成列名挡掉",
        example="PI() * POW({半径}, 2)",
        args=(),
    ),
    FunctionDoc(
        name="E",
        category="const",
        signature="E()",
        description="自然常数 e。同样要带括号",
        example="POW(E(), {x})",
        args=(),
    ),
    # 逻辑
    FunctionDoc(
        name="IF",
        category="logic",
        signature="IF(条件, 真值, 假值)",
        description="条件为真取真值，否则取假值。只算被选中的那一支",
        example="IF({温度} > 80, 1, 0)",
        args=("条件", "真值", "假值"),
    ),
    FunctionDoc(
        name="IFS",
        category="logic",
        signature="IFS(条件1, 值1, 条件2, 值2, …, 兜底值)",
        description=(
            "多分支：从左往右第一个成立的条件决定取值，都不成立取兜底值。参数"
            "个数必须是奇数"
        ),
        example="IFS({温度} > 80, 2, {温度} > 60, 1, 0)",
        args=("条件1", "值1", "兜底值"),
    ),
    FunctionDoc(
        name="NOT",
        category="logic",
        signature="NOT(条件)",
        description="取反",
        example="NOT({报警})",
        args=("条件",),
    ),
    FunctionDoc(
        name="AND",
        category="logic",
        signature="AND(条件1, 条件2, ...)",
        description=(
            "全部成立才为真。等价于 and。已经有一项不成立就判假，其余项算不出"
            "来也不影响"
        ),
        example="AND({温度} > 80, {压力} > 1)",
        args=("条件1", "条件2"),
    ),
    FunctionDoc(
        name="OR",
        category="logic",
        signature="OR(条件1, 条件2, ...)",
        description=(
            "任一成立即为真。等价于 or。已经有一项成立就判真，其余项算不出来"
            "也不影响——OR(ISBLANK({x}), {x} == 0) 在 x 为空时就是真"
        ),
        example="OR(ISBLANK({产量}), {产量} == 0)",
        args=("条件1", "条件2"),
    ),
    FunctionDoc(
        name="ISBLANK",
        category="logic",
        signature="ISBLANK(值)",
        description=(
            "值为空时为真。判空只能用它——{列} == 0 在该列为空时得到的是空、不"
            "是假，整条公式会跟着变空"
        ),
        example="IF(ISBLANK({产量}), 0, {能耗} / {产量})",
        args=("值",),
    ),
    FunctionDoc(
        name="COALESCE",
        category="logic",
        signature="COALESCE(a, b, ...)",
        description="取第一个非空值，常用于兜底默认值",
        example="COALESCE({实测值}, {设定值}, 0)",
        args=("a", "b"),
    ),
    # 聚合
    FunctionDoc(
        name="MIN",
        category="aggregate",
        signature="MIN(a, b, ...)",
        description="若干个值里的最小值（跳过空值）",
        example="MIN({A线}, {B线})",
        args=("a", "b"),
    ),
    FunctionDoc(
        name="MAX",
        category="aggregate",
        signature="MAX(a, b, ...)",
        description="若干个值里的最大值（跳过空值）",
        example="MAX({A线}, {B线})",
        args=("a", "b"),
    ),
    FunctionDoc(
        name="SUM",
        category="aggregate",
        signature="SUM(a, b, ...)",
        description="若干个值求和（跳过空值）",
        example="SUM({一号机}, {二号机}, {三号机})",
        args=("a", "b"),
    ),
    FunctionDoc(
        name="AVG",
        category="aggregate",
        signature="AVG(a, b, ...)",
        description="若干个值求平均（跳过空值）",
        example="AVG({上午}, {下午})",
        args=("a", "b"),
    ),
    # 统计量
    FunctionDoc(
        name="MEDIAN",
        category="stat",
        signature="MEDIAN(a, b, ...)",
        description="中位数（跳过空值）。比平均值抗极端值干扰",
        example="MEDIAN({一号机}, {二号机}, {三号机})",
        args=("a", "b"),
    ),
    FunctionDoc(
        name="STDEV",
        category="stat",
        signature="STDEV(a, b, ...)",
        description="样本标准差（除以 n-1）；不足 2 个有效值返回空",
        example="STDEV({班1}, {班2}, {班3})",
        args=("a", "b"),
    ),
    FunctionDoc(
        name="VAR",
        category="stat",
        signature="VAR(a, b, ...)",
        description="样本方差（除以 n-1）；不足 2 个有效值返回空",
        example="VAR({班1}, {班2}, {班3})",
        args=("a", "b"),
    ),
    FunctionDoc(
        name="VARP",
        category="stat",
        signature="VARP(a, b, ...)",
        description="总体方差（除以 n）。这几个值就是全部总体时用它",
        example="VARP({班1}, {班2}, {班3})",
        args=("a", "b"),
    ),
    # 跨行与时间窗
    FunctionDoc(
        name="PREV",
        category="history",
        signature="PREV({列}, n)",
        description="上一条记录的值；n 省略为 1，表示往前第 n 条",
        example="{电表读数} - PREV({电表读数})",
        args=("列", "往前第几条"),
    ),
    FunctionDoc(
        name="SUM_OVER",
        category="history",
        signature="SUM_OVER({列}, '1h')",
        description="最近一段时间内该列的合计（含当前行）",
        example="SUM_OVER({产量}, '1d')",
        args=("列", "时间范围"),
    ),
    FunctionDoc(
        name="AVG_OVER",
        category="history",
        signature="AVG_OVER({列}, '1h')",
        description="最近一段时间内该列的平均值",
        example="AVG_OVER({温度}, '1h')",
        args=("列", "时间范围"),
    ),
    FunctionDoc(
        name="MIN_OVER",
        category="history",
        signature="MIN_OVER({列}, '1h')",
        description="最近一段时间内该列的最小值",
        example="MIN_OVER({压力}, '6h')",
        args=("列", "时间范围"),
    ),
    FunctionDoc(
        name="MAX_OVER",
        category="history",
        signature="MAX_OVER({列}, '1h')",
        description="最近一段时间内该列的最大值",
        example="MAX_OVER({压力}, '6h')",
        args=("列", "时间范围"),
    ),
    FunctionDoc(
        name="COUNT_OVER",
        category="history",
        signature="COUNT_OVER({列}, '1h')",
        description="最近一段时间内该列有值的记录条数",
        example="COUNT_OVER({故障码}, '1d')",
        args=("列", "时间范围"),
    ),
    FunctionDoc(
        name="FIRST_OVER",
        category="history",
        signature="FIRST_OVER({列}, '1h')",
        description="最近一段时间内最早的一个值",
        example="FIRST_OVER({液位}, '1d')",
        args=("列", "时间范围"),
    ),
    FunctionDoc(
        name="LAST_OVER",
        category="history",
        signature="LAST_OVER({列}, '1h')",
        description="最近一段时间内最新的一个值",
        example="LAST_OVER({液位}, '1d')",
        args=("列", "时间范围"),
    ),
    FunctionDoc(
        name="ALL_ZERO_OVER",
        category="history",
        signature="ALL_ZERO_OVER({列}, '12mo')",
        description=(
            "最近一段时间内有值且全部为 0 时为真；有非零值为假；一个值都没有则"
            "为空（与「全是 0」区分开）"
        ),
        example="IF(ALL_ZERO_OVER({产量}, '12mo'), 0, {能耗} / {产量})",
        args=("列", "时间范围"),
    ),
    # 整列统计
    FunctionDoc(
        name="MIN_ALL",
        category="whole",
        signature="MIN_ALL({列})",
        description="整列的最小值（全表所有记录）",
        example="{值} - MIN_ALL({值})",
        args=("列",),
    ),
    FunctionDoc(
        name="MAX_ALL",
        category="whole",
        signature="MAX_ALL({列})",
        description="整列的最大值（全表所有记录）",
        example="MAX_ALL({值}) - MIN_ALL({值})",
        args=("列",),
    ),
    FunctionDoc(
        name="AVG_ALL",
        category="whole",
        signature="AVG_ALL({列})",
        description="整列的平均值，常用于算偏差",
        example="{值} - AVG_ALL({值})",
        args=("列",),
    ),
    FunctionDoc(
        name="SUM_ALL",
        category="whole",
        signature="SUM_ALL({列})",
        description="整列的合计，常用于算占比",
        example="{产量} / SUM_ALL({产量}) * 100",
        args=("列",),
    ),
    FunctionDoc(
        name="COUNT_ALL",
        category="whole",
        signature="COUNT_ALL({列})",
        description="整列有值的记录条数",
        example="COUNT_ALL({产量})",
        args=("列",),
    ),
)
