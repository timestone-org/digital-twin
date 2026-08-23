"""解析前的两趟文本替换：`@公式标识(` 与 `{列key}` → 占位标识符。

⚠ 两趟都发生在 `ast.parse` **之前**，所以替换必须跳过引号跨度——否则
`IF({a}>0, "{x}", "")` 会把字符串里的 `{x}` 误读成列引用。参考实现把「字符串
里不许出现 `{` `}` `@`」当成已知限制留着，本仓在这里修掉
（docs/DATASET_DESIGN.md §5.1）。
"""

import ast
import re
from collections.abc import Callable

from platform_server.apps.dataset.formula.errors import FormulaError

# 列引用 `{列key}`；内层不许再有花括号，故一次匹配吃不到嵌套
COLUMN_REF_RE = re.compile(r"\{([^{}]*)\}")
# 列标识：放行中文，禁掉公式语法里的全部记号。
# ⚠ 与 `models.column.KEY_PATTERN` 是同一条规则的两份写法，由
# `tests/contract/test_dataset_formula_catalog.py` 逐字符钉住
COLUMN_KEY_RE = re.compile(r"^[^\s@{}:,.'\"()\[\]]{1,64}$")
# 跨表引用 `{表code.列key}`：点号后面那截仍按列标识校验。
# ⚠ 按**第一个**点号切：列标识本身禁点号，所以切法无歧义。台账编码允许含点号
# （`TableCode` 放行 `.`），那样的表跨表引用不到——报的是「列标识不合法」，
# 不是静默算空
EXTERNAL_RE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9_-]*)\.(.+)$")
# 库公式调用 `@标识(`；只改写函数名那一段，实参原样留着按普通表达式解析
FX_CALL_RE = re.compile(r"@([^\s@{}()\[\],:.'\"]+)\s*\(")
# Python 字符串字面量。单双引号各一支，含转义
_STRING_RE = re.compile(r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"")

_REF_PLACEHOLDER_FMT = "_c{}_"
_FX_PLACEHOLDER_FMT = "_fx{}_"
_MISSING_PARENS = (
    "调用库公式要带括号，写作 @公式标识(实参)；零参公式也要写成 @公式标识()"
)


def substitute_macros(source: str) -> tuple[str, dict[str, str]]:
    """`@公式标识(` → 占位函数名，返回 (替换后源码, {占位: 公式标识})。

    Args: source。
    """
    codes: dict[str, str] = {}
    seen: dict[str, str] = {}

    def rewrite(found: re.Match[str]) -> str:
        code = found.group(1)
        if code not in seen:
            name = _FX_PLACEHOLDER_FMT.format(len(seen))
            seen[code] = name
            codes[name] = code
        return f"{seen[code]}("

    substituted = _replace_outside_quotes(source, FX_CALL_RE, rewrite)
    # 裸 `@某公式` 会一路漏到 ast.parse 报 "invalid syntax"，那句话指不出问题
    # 在哪；引号里的 `@` 不算，那只是一段文本
    if _has_outside_quotes(substituted, "@"):
        raise FormulaError(_MISSING_PARENS)
    return substituted, codes


def substitute_refs(source: str) -> tuple[str, dict[str, str]]:
    """`{列key}` → 占位标识符，返回 (替换后源码, {占位: 引用原文})。

    同一个 key 复用同一个占位符，依赖去重与求值取数都靠它。
    Args: source。
    """
    placeholders: dict[str, str] = {}
    seen: dict[str, str] = {}

    def rewrite(found: re.Match[str]) -> str:
        key = _checked_key(found.group(1).strip())
        if key not in seen:
            name = _REF_PLACEHOLDER_FMT.format(len(seen))
            seen[key] = name
            placeholders[name] = key
        return seen[key]

    return _replace_outside_quotes(source, COLUMN_REF_RE, rewrite), placeholders


def to_expression(
    source: str,
) -> tuple[ast.Expression, dict[str, str], dict[str, str]]:
    """文本 → (表达式 AST, {占位: 引用原文}, {占位: 库公式标识})。

    两趟替换加一次 `ast.parse`，只做这三步——公式**不执行**，借的只是 CPython
    的表达式语法。⚠ 用它而不是手写 Pratt 解析器：优先级与结合性一旦与人的直觉
    差一点点，表现就是「算出来的数不对但看不出哪不对」（§5.1）。
    ⚠ `RecursionError` 必须接住：深嵌套的 `1+1+1+…` 会打穿 AST 递归栈，而校验
    端点只要读权限就能调，不接就是白送的 DoS。
    Args: source。
    """
    substituted, codes = substitute_macros(source)
    substituted, placeholders = substitute_refs(substituted)
    try:
        tree = ast.parse(substituted, mode="eval")
    except SyntaxError as error:
        raise FormulaError(f"公式语法错误：{error.msg}") from error
    except RecursionError as error:
        raise FormulaError("公式嵌套过深，请拆成多列分步计算") from error
    return tree, placeholders, codes


def intern_ref(key: str, placeholders: dict[str, str]) -> str:
    """把一个引用原文并进占位空间，返回它的占位符（已在则复用）。

    库公式体里的跨表引用是绝对地址，展开后仍要被求值器认出来，故必须落进
    调用方这一份占位表。
    Args: key, placeholders。
    """
    for name, existing in placeholders.items():
        if existing == key:
            return name
    index = len(placeholders)
    name = _REF_PLACEHOLDER_FMT.format(index)
    while name in placeholders:
        index += 1
        name = _REF_PLACEHOLDER_FMT.format(index)
    placeholders[name] = key
    return name


def split_external(key: str) -> tuple[str, str] | None:
    """把 `表code.列key` 拆成两段；不是跨表引用则给 None。

    Args: key。
    """
    found = EXTERNAL_RE.match(key)
    return None if found is None else (found.group(1), found.group(2))


def _checked_key(key: str) -> str:
    """校验一个列引用原文，返回它自己。

    Args: key。
    """
    if not key:
        raise FormulaError("列引用 {} 里的列名不能为空")
    external = split_external(key)
    if external is not None:
        if not COLUMN_KEY_RE.match(external[1]):
            raise FormulaError(
                f"跨表引用 {{{key}}} 里的列标识不合法：不能含空格、引号、"
                "冒号、逗号、点号或括号"
            )
        return key
    if not COLUMN_KEY_RE.match(key):
        raise FormulaError(
            f"列引用 {{{key}}} 不合法：列标识不能含空格、引号、冒号、"
            "逗号、点号或括号"
        )
    return key


def _quoted_spans(source: str) -> list[tuple[int, int]]:
    """全部字符串字面量占的区间（左闭右开）。

    Args: source。
    """
    return [
        (found.start(), found.end()) for found in _STRING_RE.finditer(source)
    ]


def _is_inside(position: int, spans: list[tuple[int, int]]) -> bool:
    """这个偏移落在某个字符串字面量里吗。

    Args: position, spans。
    """
    return any(start <= position < end for start, end in spans)


def _replace_outside_quotes(
    source: str,
    pattern: re.Pattern[str],
    rewrite: Callable[[re.Match[str]], str],
) -> str:
    """按 pattern 逐处替换，落在引号跨度里的匹配原样保留。

    Args: source, pattern, rewrite。
    """
    spans = _quoted_spans(source)
    pieces: list[str] = []
    cursor = 0
    for found in pattern.finditer(source):
        if _is_inside(found.start(), spans):
            continue
        pieces.append(source[cursor : found.start()])
        pieces.append(rewrite(found))
        cursor = found.end()
    pieces.append(source[cursor:])
    return "".join(pieces)


def _has_outside_quotes(source: str, needle: str) -> bool:
    """引号之外还有这个字符吗。

    Args: source, needle。
    """
    spans = _quoted_spans(source)
    return any(
        not _is_inside(position, spans)
        for position, char in enumerate(source)
        if char == needle
    )
