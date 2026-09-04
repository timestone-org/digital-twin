#!/usr/bin/env python3
"""许可证闸：engineering-workflow.md §5.3。

本项目私有部署交付，传染性许可证不可接受。GPL/AGPL 系一律阻断；
其余非白名单许可证要在 `licenses-reviewed.json` 里留下逐个评估的结论。

读的是**已安装的依赖元数据**，不联网：Python 走 importlib.metadata，
Node 走 pnpm 的 store 目录。
"""

from __future__ import annotations

import json
import re
from importlib import metadata
from pathlib import Path
from typing import cast

from _report import ROOT, Violation, at, main, read

REVIEWED = Path(__file__).resolve().parent / "licenses-reviewed.json"
PNPM_STORE = ROOT / "web" / "node_modules" / ".pnpm"

ALLOWED = re.compile(
    r"^(MIT|MIT-0|BSD|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0|ISC"
    r"|Python-2\.0|PSF-2\.0|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Zlib"
    r"|Apache Software License|MIT License|BSD License"
    r"|ISC License \(ISCL\)|The Unlicense \(Unlicense\))$",
    re.IGNORECASE,
)
# SPDX 复合表达式的两个连接词。
# ⚠ **AND 与 OR 不是一回事**。`MIT AND GPL-3.0` 要同时满足两份许可，
# 而 `MIT OR GPL-3.0` 是让接收方**挑一份**——挑 MIT 就不沾传染性。
# 把两者当成同一件事的那一版把 `(MIT OR GPL-3.0-or-later)` 判成传染性并硬阻断，
# 于是一整类「双许可任选」的包（jszip 是其中之一）连评审的机会都没有。
# ⚠ 只认**大写**：SPDX 规定连接词大写，而放开大小写之后，散文式许可字段里
# 那些平常的「or」会被当成连接词，把一句话切成两截都不成立的碎片
SPDX_OPERATOR = re.compile(r"(?<![\w-])(AND|OR)(?![\w-])")
# 传染性：私有部署交付时不可接受。LGPL 不在此列，故 `GPL` 前有个 (?<!L)
# ⚠ 缩写与全称都要认：有的包不给 SPDX 标识符只给一段散文，那里出现的是
# 「GNU GENERAL PUBLIC LICENSE」而不是「GPL」，只认缩写等于放它过去。
FORBIDDEN = re.compile(
    r"\b(?<!L)GPL|AGPL|SSPL|Commons Clause\b"
    r"|(?<!LESSER )GNU GENERAL PUBLIC LICENSE|AFFERO",
    re.IGNORECASE,
)
CLASSIFIER = re.compile(r"^License :: (?:OSI Approved :: )?(?P<name>.+)$")


def _unwrap(text: str) -> str:
    """去掉整体外层的一对括号；`ISC License (ISCL)` 这类不动。

    Args: text。
    """
    stripped = text.strip()
    if stripped.startswith("(") and stripped.endswith(")"):
        return stripped[1:-1].strip()
    return stripped


def _split_top(expression: str, operator: str) -> list[str]:
    """按**括号之外**的某个运算符切开；括号原样留在切片里。

    ⚠ 不能拿正则直接切：`MPL-2.0 AND (Apache-2.0 OR MIT)` 里那个 OR 在括号
    之内，顶层切开它会切出两个都不成立的半句，而结论会是「这个包哪一支都不
    可接受」——一个完全说得通、却与表达式原意相反的答案。

    Args: expression, operator（大写的 `AND` 或 `OR`）。
    """
    chunks: list[str] = []
    start = 0
    for match in SPDX_OPERATOR.finditer(expression):
        head = expression[: match.start()]
        # 括号没配平即还在括号之内，这一个连接词不是顶层的
        if match.group(1) != operator or head.count("(") != head.count(")"):
            continue
        chunks.append(expression[start : match.start()])
        start = match.end()
    chunks.append(expression[start:])
    return [chunk.strip() for chunk in chunks if chunk.strip()]


def _is_allowed(license_name: str) -> bool:
    """OR 的**任一支**可接受即可接受；AND 的**每一项**都要可接受。

    ⚠ 这正是 SPDX 的语义，也是 `MIT OR GPL-3.0-or-later` 这类声明的用法：
    接收方挑一份，我们挑的是 MIT 那一份。

    Args: license_name。
    """
    return any(
        all(_is_leaf_allowed(item) for item in _split_top(branch, "AND"))
        for branch in _split_top(license_name, "OR")
    )


def _is_leaf_allowed(item: str) -> bool:
    """一项：还带括号就往里再判一层，否则比白名单。

    ⚠ `WITH` 不拆：`Apache-2.0 WITH LLVM-exception` 整句不在白名单里，
    于是它照旧要走评审——例外条款得有人读过才算数。

    Args: item。
    """
    inner = _unwrap(item)
    if inner != item.strip():
        return _is_allowed(inner)
    return bool(ALLOWED.match(inner))


def _first_party() -> set[str]:
    """本仓自己的 workspace 成员不参与许可证评估。"""
    names: set[str] = set()
    for manifest in sorted((ROOT / "server").rglob("pyproject.toml")):
        match = re.search(
            r'^name\s*=\s*"(?P<name>[^"]+)"', read(manifest), re.MULTILINE
        )
        if match is not None:
            names.add(f"py:{match.group('name')}")
    return names


def _is_recorded(name: str, known: set[str]) -> bool:
    """结论清单支持 `*` 前缀通配——同一个包的各平台产物只需记一条。

    Args: name, known。
    """
    return any(
        name == entry or (entry.endswith("*") and name.startswith(entry[:-1]))
        for entry in known
    )


def _reviewed() -> dict[str, str]:
    if not REVIEWED.is_file():
        return {}
    loaded: dict[str, str] = json.loads(read(REVIEWED))
    return loaded


def _python_licenses() -> dict[str, str]:
    found: dict[str, str] = {}
    for distribution in metadata.distributions():
        name = distribution.metadata["Name"]
        if not name:
            continue
        found[f"py:{name}"] = _license_of(distribution)
    return found


def _license_of(distribution: metadata.Distribution) -> str:
    expression = distribution.metadata.get("License-Expression")
    if expression:
        return str(expression)
    for value in distribution.metadata.get_all("Classifier") or []:
        match = CLASSIFIER.match(str(value))
        if match is not None:
            return match.group("name")
    return _first_line(str(distribution.metadata.get("License") or "未声明"))


def _first_line(value: str) -> str:
    """取许可证字段的首个非空行。

    ⚠ 有的包把整篇许可证正文塞进 `License` 字段（pymssql 是 513 行）。整篇正文
    里必然反复出现 GPL 字样，逐字扫描于是把 LGPL 判成 GPL；而首行恰恰是许可证
    的正名。只截首行是安全的**前提是** FORBIDDEN 同时认全称，否则 GPL 正文的
    首行「GNU GENERAL PUBLIC LICENSE」里没有 GPL 三个字母，会整个漏过去。
    Args: value。
    """
    for line in value.splitlines():
        if line.strip():
            return line.strip()
    return value.strip()


def _node_licenses() -> dict[str, str]:
    if not PNPM_STORE.is_dir():
        return {}
    found: dict[str, str] = {}
    for manifest in sorted(PNPM_STORE.glob("*/node_modules/*/package.json")):
        found.update(_node_entry(manifest))
    for manifest in sorted(PNPM_STORE.glob("*/node_modules/@*/*/package.json")):
        found.update(_node_entry(manifest))
    return found


def _node_entry(manifest: Path) -> dict[str, str]:
    try:
        payload = _as_object(json.loads(read(manifest)))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    name = payload.get("name")
    if not isinstance(name, str):
        return {}
    raw = payload.get("license") or payload.get("licenses") or "未声明"
    return {f"npm:{name}": _spell(raw)}


def _as_object(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return cast("dict[str, object]", value)
    return {}


def _spell(raw: object) -> str:
    """package.json 的 license 有字符串、对象、数组三种历史写法。

    Args: raw。
    """
    if isinstance(raw, list):
        items = cast("list[object]", raw)
        return " OR ".join(_spell(item) for item in items)
    if isinstance(raw, dict):
        return str(cast("dict[str, object]", raw).get("type", "未声明"))
    return str(raw)


def check_no_copyleft() -> list[Violation]:
    """GPL / AGPL 系一律阻断，**除非**同一份声明里还给了一支宽松的可选。

    ⚠ 「还给了一支宽松的可选」不是网开一面：`MIT OR GPL-3.0-or-later` 的意思
    就是让接收方挑，挑 MIT 那一支之后这个包与传染性再无关系。判据交给
    `_is_allowed`，而那一支的**选择结论**由下面那条闸要求写进评审清单。
    """
    found: list[Violation] = []
    for name, license_name in sorted(
        {**_python_licenses(), **_node_licenses()}.items()
    ):
        if FORBIDDEN.search(license_name) and not _is_allowed(license_name):
            found.append(
                Violation(
                    "禁止传染性许可证", at(ROOT), f"{name} → {license_name}"
                )
            )
    return found


def check_other_licenses_are_reviewed() -> list[Violation]:
    """白名单之外的许可证，以及**任选一支绕开传染性**的那些，都要有结论。

    ⚠ 后半句是新加的一档：双许可任选的包能过上一条闸，靠的是「我们挑宽松那
    一支」这个**决定**。决定不写下来的话，下一个人只看得到闸门是绿的，
    看不到它为什么绿——而挑法一旦随版本变了（上游改成单一 GPL），
    这里也就没有一处能对照着复核。
    """
    known = set(_reviewed()) | _first_party()
    found: list[Violation] = []
    for name, license_name in sorted(
        {**_python_licenses(), **_node_licenses()}.items()
    ):
        if _is_allowed(license_name) and not FORBIDDEN.search(license_name):
            continue
        if FORBIDDEN.search(license_name) and not _is_allowed(license_name):
            # 上一条闸已经把它硬阻断了，不必再要一份结论
            continue
        if _is_recorded(name, known):
            continue
        found.append(
            Violation(
                "非白名单许可证需要记录结论",
                at(REVIEWED),
                f"{name} → {license_name}",
            )
        )
    return found


CHECKS = (check_no_copyleft, check_other_licenses_are_reviewed)


if __name__ == "__main__":
    raise SystemExit(main("许可证检查", CHECKS))
