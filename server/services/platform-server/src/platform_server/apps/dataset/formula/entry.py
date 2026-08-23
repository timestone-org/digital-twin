"""一条库公式自身的校验，以及给它拼一条样例调用。

⚠ **公式体不能单独校验。** 一个 `value` 形参落在只收字面量的位置（`PREV` 的
期数、时间窗字面量），单独解析必然报「该位置必须是字面量」——那是校验方法的
问题，不是公式的问题。故一律拼出样例调用，走与真实调用完全相同的那条解析链：
嵌套、元数、白名单与成环一次全查（docs/DATASET_DESIGN.md §5.11）。
"""

import re
from dataclasses import replace

from platform_server.apps.dataset.formula.errors import FormulaError
from platform_server.apps.dataset.formula.library import (
    EMPTY_LIBRARY,
    FX_CODE_RE,
    FX_PARAM_KINDS,
    PARAM_COLUMN,
    FormulaLibrary,
    FxEntry,
    FxParam,
)
from platform_server.apps.dataset.formula.parser import parse_formula
from platform_server.apps.dataset.formula.tokens import (
    COLUMN_KEY_RE,
    COLUMN_REF_RE,
)

# 形参没给默认值时，样例调用里替它填的数。取 1 不取 0：它还要去当除数
_SAMPLE_FALLBACK = 1
# 只有「这里必须是字面量」那一类报错才配得上默认值提示，别的错照原样呈现
_LITERAL_COMPLAINT = re.compile(r"字面量|时间窗|整数")


def sample_call(entry: FxEntry) -> str:
    """给一条库公式拼一条样例调用 `@标识(实参…)`。

    列形参填 `{形参名}`，值形参填**它自己的默认值**——默认值不是界面上的预填，
    它是「这个位置该放什么」的唯一声明（§5.11）。
    Args: entry。
    """
    args = [_sample_arg(param) for param in entry.params]
    return f"@{entry.code}({', '.join(args)})"


def validate_entry(
    entry: FxEntry, library: FormulaLibrary = EMPTY_LIBRARY
) -> None:
    """校验一条库公式；任何不合法都抛 `FormulaError`。

    Args: entry, library（库快照，用来查嵌套调用与成环；本条会顶替同标识的
        旧版本）。
    """
    _check_code(entry.code)
    _check_name(entry.name)
    check_params(entry.params)
    _check_expression(entry.expression)
    referenced = _referenced_names(entry.expression)
    _check_no_stray(entry, referenced)
    _check_all_used(entry, referenced)
    _check_sample_call(entry, library)


def check_params(params: tuple[FxParam, ...]) -> None:
    """形参名、种类与重名。

    Args: params。
    """
    seen: set[str] = set()
    for param in params:
        if not COLUMN_KEY_RE.match(param.name):
            raise FormulaError(
                f"形参名 '{param.name}' 不合法：不能为空，且不能含空格、"
                "括号、花括号、引号、逗号、冒号、点号或 @"
            )
        if param.kind not in FX_PARAM_KINDS:
            raise FormulaError(
                f"形参「{param.display}」的种类 '{param.kind}' 未知："
                f"只能是 {'、'.join(FX_PARAM_KINDS)}"
            )
        if param.name in seen:
            raise FormulaError(f"形参名重复：{param.name}")
        seen.add(param.name)


def merged_library(entry: FxEntry, library: FormulaLibrary) -> FormulaLibrary:
    """把这一条顶替进快照，让校验看到的是保存之后的库。

    Args: entry, library。
    """
    if library.get(entry.code) == entry:
        return library
    kept = [
        item for item in library.entries.values() if item.code != entry.code
    ]
    return FormulaLibrary.of([*kept, entry])


def _sample_arg(param: FxParam) -> str:
    """样例调用里这个形参该填什么。

    Args: param。
    """
    if param.kind == PARAM_COLUMN:
        return f"{{{param.name}}}"
    given = param.default if param.default is not None else _SAMPLE_FALLBACK
    return repr(given)


def _check_code(code: str) -> None:
    """公式标识。与列 key 同一套禁令。

    Args: code。
    """
    if not FX_CODE_RE.match(code):
        raise FormulaError(
            f"公式标识 '{code}' 不合法：不能为空，且不能含空格、括号、"
            "花括号、引号、逗号、冒号、点号或 @"
        )


def _check_name(name: str) -> None:
    """公式名称。

    Args: name。
    """
    if not name.strip():
        raise FormulaError("公式名称不能为空")


def _check_expression(expression: str) -> None:
    """公式体。

    Args: expression。
    """
    if not expression.strip():
        raise FormulaError("公式体不能为空")


def _referenced_names(expression: str) -> list[str]:
    """体里 `{…}` 引用到的全部名字，按出现顺序、不去重。

    ⚠ 扫的是**原文**而不是解析结果：形参在展开之后就不存在了，从 AST 上
    反推不回来。
    Args: expression。
    """
    return [
        found.group(1).strip() for found in COLUMN_REF_RE.finditer(expression)
    ]


def _check_no_stray(entry: FxEntry, referenced: list[str]) -> None:
    """体里不许引用没声明的形参。

    ⚠ 跨表引用 `{表code.列key}` 是绝对地址，放行——它指的是一张具体的台账，
    不是调用方传进来的东西。
    Args: entry, referenced。
    """
    declared = {param.name for param in entry.params}
    stray = sorted(
        {
            name
            for name in referenced
            if "." not in name and name not in declared
        }
    )
    if stray:
        raise FormulaError(
            f"公式体引用了未声明的形参：{'、'.join(stray)}"
            "——库公式不能直接写死某张台账的列，请把它声明成形参"
        )


def _check_all_used(entry: FxEntry, referenced: list[str]) -> None:
    """声明了的形参必须在体里用到。

    Args: entry, referenced。
    """
    used = set(referenced)
    idle = [param.display for param in entry.params if param.name not in used]
    if idle:
        raise FormulaError(
            f"形参 {'、'.join(idle)} 在公式体里没被用到"
            "——调用方会被要求填一个不起作用的参数"
        )


def _check_sample_call(entry: FxEntry, library: FormulaLibrary) -> None:
    """拿样例调用跑一遍真解析。

    ⚠ 校验时**把这一条自己当成启用的**：停用开关管的是「谁还能调它」，不是
    「它写得对不对」。不这么办的话，停用一条公式的那次保存会被它自己的
    「已停用」挡下来——一个永远关不掉的开关。库里**别的**条目照原样，故草稿
    去调一条已停用的公式仍然该拒。
    Args: entry, library。
    """
    known = {param.name for param in entry.params if param.kind == PARAM_COLUMN}
    draft = entry if entry.is_enabled else replace(entry, is_enabled=True)
    try:
        parse_formula(
            sample_call(entry), known, library=merged_library(draft, library)
        )
    except FormulaError as error:
        raise FormulaError(f"{error}{_default_hint(entry, error)}") from error


def _default_hint(entry: FxEntry, error: FormulaError) -> str:
    """值形参缺默认值时，把报错指回该改的那个字段。

    ⚠ 引擎那句话指的是**样例调用**里的某个位置，而用户要改的是「默认值」那一
    栏——不补这一句，他会去改一个根本没写错的地方（§5.11）。
    Args: entry, error。
    """
    if not _LITERAL_COMPLAINT.search(str(error)):
        return ""
    blank = [
        param.display
        for param in entry.params
        if param.kind != PARAM_COLUMN and param.default is None
    ]
    if not blank:
        return ""
    return (
        f"。⚠ 形参 {'、'.join(blank)} 还没有默认值，而默认值就是它在体里那个"
        "位置的唯一声明（时间窗、PREV 的期数只收字面量）——请先把默认值填上"
    )
