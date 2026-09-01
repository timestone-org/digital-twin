"""依赖图与整表试编译：求值顺序、环检测、跨表编码校验。

⚠ 保存一个公式列**必定跑一次整表试编译**，而不是只编译这一列——环是整表的
性质。试编译时要带齐全部相位输入（已知列集合、跨表编码、公式库），漏任何一项
今天都表现为静默算空（docs/DATASET_DESIGN.md §5.8）。
"""

from collections.abc import Mapping, Sequence
from dataclasses import InitVar, dataclass, field

from platform_server.apps.dataset.formula.errors import FormulaError
from platform_server.apps.dataset.formula.library import (
    EMPTY_LIBRARY,
    FormulaLibrary,
)
from platform_server.apps.dataset.formula.parser import parse_formula
from platform_server.apps.dataset.formula.refs import (
    ExternalRef,
    ParsedFormula,
    PrevRef,
    WholeRef,
    WindowRef,
)

# 只有 `build_plan` 拿得到它。理由见 `ComputePlan`
_BUILT_BY_BUILD_PLAN = object()


@dataclass(frozen=True)
class ColumnFormula:
    """一列公式的编译输入。`name` 只用于报错文案。"""

    key: str
    name: str
    formula: str


@dataclass(frozen=True)
class ComputePlan:
    """整表试编译的产物：算什么、按什么顺序算、要取哪些外部值。

    ⚠ 只能由 `build_plan` 造出来（`built_by` 是模块私有的构造令牌）。手搓一个
    等于手抄「哪些相位是必需的」，而今天每一处遗漏都表现为**一列静默算空**，
    不是报错（docs/DATASET_DESIGN.md §5.8）。
    """

    built_by: InitVar[object]
    #: 求值顺序，被依赖的在前。编译不过的列不在其中
    order: list[str] = field(default_factory=list[str])
    #: {列key: 已解析公式}
    parsed: dict[str, ParsedFormula] = field(
        default_factory=dict[str, ParsedFormula]
    )
    #: {列key: 编译不过的原因}。⚠ 编译不过的列**不让整表编译失败**：一次
    #: `force` 删列会让引用它的那几列同时坏掉，若整表随之编不过，用户连挨个
    #: 修都做不到——每改一列都会被别的坏列挡回来。坏列各自记一条原因，落到
    #: 那一格的 `compute_error` 上（docs/DATASET_DESIGN.md §5.4 第 3 条）
    failures: dict[str, str] = field(default_factory=dict[str, str])
    library: FormulaLibrary = EMPTY_LIBRARY

    def __post_init__(self, built_by: object) -> None:
        """挡住手搓的计划。

        Args: built_by。
        """
        if built_by is not _BUILT_BY_BUILD_PLAN:
            raise TypeError("ComputePlan 只能由 build_plan 构造")

    @property
    def is_empty(self) -> bool:
        """这张表一列公式都没有。"""
        return not self.order

    @property
    def prev_refs(self) -> set[PrevRef]:
        """全部跨行引用，去重后一次取数。"""
        return {ref for item in self.parsed.values() for ref in item.deps.prev}

    @property
    def window_refs(self) -> set[WindowRef]:
        """全部时间窗引用。"""
        return {
            ref for item in self.parsed.values() for ref in item.deps.window
        }

    @property
    def whole_refs(self) -> set[WholeRef]:
        """全部整列聚合引用。"""
        return {ref for item in self.parsed.values() for ref in item.deps.whole}

    @property
    def model_refs(self) -> set[str]:
        """这张表的公式一共调了哪几个模型。

        ⚠ 取数层照着这组派生属性决定装哪些相位；不加这一条的话，新引用在两条
        路径上都**静默读不到东西**——而 `ExternalsNotPrefetched` 只在「键建了
        但没填」时才响，键压根没建是不响的（docs/MODELING_DESIGN.md §7.2）。
        """
        return {
            ref.code for item in self.parsed.values() for ref in item.deps.model
        }

    @property
    def external_refs(self) -> set[ExternalRef]:
        """全部跨表直接引用。"""
        return {
            ref for item in self.parsed.values() for ref in item.deps.external
        }

    @property
    def needs_history(self) -> bool:
        """算这张表要不要读别的行。

        这条同时是「改一行会不会让别的行过期」的判据。
        """
        return bool(
            self.prev_refs
            or self.window_refs
            or self.whole_refs
            or self.external_refs
        )

    @property
    def needs_whole(self) -> bool:
        """有没有**本表**的整列聚合。

        ⚠ 跨表的 `*_ALL` 不算：往本表写一行不会改变对方表的聚合值，算进来会
        让每一次单行写入都触发一次全表重算。
        """
        return any(ref.table_code is None for ref in self.whole_refs)

    @property
    def external_table_codes(self) -> set[str]:
        """引用到的外部台账编码。"""
        codes: set[str] = set()
        for item in self.parsed.values():
            codes |= item.deps.external_table_codes
        return codes


def build_plan(
    columns: Sequence[ColumnFormula],
    known_keys: set[str],
    *,
    known_tables: frozenset[str] = frozenset(),
    library: FormulaLibrary = EMPTY_LIBRARY,
) -> ComputePlan:
    """整表试编译：逐列解析、连边、拓扑排序、校验跨表编码。

    Args: columns（全部公式列）, known_keys（表内全部列 key）,
        known_tables（可引用的台账编码）, library。
    """
    parsed: dict[str, ParsedFormula] = {}
    failures: dict[str, str] = {}
    for column in columns:
        try:
            parsed[column.key] = _parse_column(
                column, known_keys, known_tables, library
            )
        except FormulaError as error:
            failures[column.key] = str(error)
    # ⚠ 环反过来**必须**让整表编译失败：它不归任何一列，也不是谁「自己坏了」，
    # 而是这一批公式合起来没有可执行的顺序
    order = topo_order(_edges_of(parsed), set(parsed))
    return ComputePlan(
        _BUILT_BY_BUILD_PLAN,
        order=order,
        parsed=parsed,
        failures=failures,
        library=library,
    )


def topo_order(
    deps_by_key: Mapping[str, set[str]], all_keys: set[str]
) -> list[str]:
    """公式列的求值顺序（被依赖的在前）；成环抛 `FormulaError` 并点名环上的列。

    ⚠ **自环不豁免**：列 `a` 的公式里出现 `{a}` 是货真价实的环。
    ⚠ 队列全程保持有序，同层的输出才可复现——否则两次重算给出不同的顺序，
    而 `*_ALL` 这类公式的结果与顺序有关。
    Args: deps_by_key, all_keys。
    """
    indegree = dict.fromkeys(all_keys, 0)
    dependents: dict[str, list[str]] = {key: [] for key in all_keys}
    for key in all_keys:
        for dep in deps_by_key.get(key, set()):
            # 只有指向其它公式列的边才算：引用一个录入列不构成先后关系
            if dep in all_keys:
                indegree[key] += 1
                dependents[dep].append(key)
    order = _drain(indegree, dependents)
    if len(order) != len(all_keys):
        cycle = sorted(all_keys - set(order))
        raise FormulaError(f"公式存在循环引用：{' → '.join(cycle)}")
    return order


def _drain(
    indegree: dict[str, int], dependents: Mapping[str, list[str]]
) -> list[str]:
    """Kahn 的主循环。

    Args: indegree, dependents。
    """
    queue = sorted(key for key, degree in indegree.items() if degree == 0)
    order: list[str] = []
    while queue:
        key = queue.pop(0)
        order.append(key)
        for following in dependents[key]:
            indegree[following] -= 1
            if indegree[following] == 0:
                queue.append(following)
                queue.sort()
    return order


def _edges_of(parsed: Mapping[str, ParsedFormula]) -> dict[str, set[str]]:
    """求值顺序的依赖图 = 同行引用 ∪ 指向**其它**公式列的本表窗口引用。

    ⚠ `PREV` 与自引用窗口**不连边**：它们读的是别的行，不构成同一行内的先后
    关系。自引用窗口尤其不能连——`{累计} = SUM_OVER({累计}, '1y')` 是合法写法，
    连边就成了自环（docs/DATASET_DESIGN.md §5.8）。
    Args: parsed。
    """
    return {
        key: set(item.deps.same_row)
        | {
            ref.key
            for ref in item.deps.window
            if ref.table_code is None and ref.key in parsed and ref.key != key
        }
        for key, item in parsed.items()
    }


def _parse_column(
    column: ColumnFormula,
    known_keys: set[str],
    known_tables: frozenset[str],
    library: FormulaLibrary,
) -> ParsedFormula:
    """解析一列，报错时点名是哪一列。

    Args: column, known_keys, known_tables, library。
    """
    try:
        parsed = parse_formula(column.formula, known_keys, library=library)
        _require_known_tables(parsed.deps.external_table_codes, known_tables)
    except FormulaError as error:
        raise FormulaError(f"列「{column.name}」的公式有误：{error}") from error
    return parsed


def _require_known_tables(used: set[str], known_tables: frozenset[str]) -> None:
    """引用到的台账编码必须都存在。

    ⚠ 三个入口（直接引用 / 窗口 / 整列）都要收进来。漏一个的表现是取数期解析
    不出 table_id，那一列静默算空。
    Args: used, known_tables。
    """
    missing = sorted(used - known_tables)
    if missing:
        raise FormulaError(f"引用了不存在的台账：{'、'.join(missing)}")
