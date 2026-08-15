#!/usr/bin/env python3
"""测试质量闸：testing-standard-python.md §2、§5、§6 与 TS 侧的对应条目。

覆盖率只证明代码被执行过，不证明它被验证过——一个没有 assert 的测试
可以拿到 100%。这一组拦的是覆盖率数字看不见的那些洞。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from _report import (
    PY,
    Violation,
    at,
    functions,
    iter_files,
    main,
    parse,
    python_test_roots,
    read,
    web_tests,
)

# 测试名写这条用例断言的是什么契约，不写它回归自哪次修复。
# ⚠ 必须按词切：`issued` / `debug` / `prefix` 里都藏着这些词的字面。
PROVENANCE_WORDS = frozenset(
    {"fix", "fixes", "fixed", "bug", "bugfix", "issue", "regression"}
)
PROVENANCE_TEXT = re.compile(r"回归|修复|复现|#\d+")
# ⚠ 前面必须挡掉 `.`：`RE.test(x)` / `obj.it(...)` 里的 `test` / `it` 是成员调用，
# 认成用例之后会把它后面的括号当用例体切走，那一段里没有断言，于是凭空多出一条
# 「测试必须有断言」的违规——而被指的行根本不是一条用例。
TS_CASE = re.compile(r"(?<![.\w$])(?P<kind>it|test)(?P<each>\.each)?\s*(?=\()")
TS_FOCUS = re.compile(r"\b(?:it|test|describe)\.only\s*\(")
TS_SKIP = re.compile(r"\b(?:it|test|describe)\.skip\s*\(|\bxit\s*\(")
# 大颗粒快照证明不了任何契约，改一点就整体失效然后被无脑 -u 更新
BIG_SNAPSHOT = re.compile(r"toMatchSnapshot\s*\(\s*\)")
# 在慢机器上必然失效
SLEEP_WAIT = re.compile(r"setTimeout\s*\(\s*(?:resolve|done)\b")
ASSERTIONS = ("expect(", "assert")
LAYERS = frozenset({"unit", "integration", "contract", "e2e"})


def _python_tests() -> list[Path]:
    found: list[Path] = []
    for root in python_test_roots():
        found.extend(iter_files(root, PY))
    return found


def _test_functions(
    tree: ast.Module,
) -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    return [node for node in functions(tree) if node.name.startswith("test_")]


def check_python_tests_assert_something() -> list[Violation]:
    """只调用不检查的用例等于没测。"""
    found: list[Violation] = []
    for path in _python_tests():
        tree = parse(path)
        if tree is None:
            continue
        for node in _test_functions(tree):
            if _has_assertion(node):
                continue
            found.append(
                Violation(
                    "测试必须有断言",
                    at(path, node.lineno),
                    node.name,
                )
            )
    return found


def _has_assertion(node: ast.AST) -> bool:
    for child in ast.walk(node):
        if isinstance(child, ast.Assert):
            return True
        if isinstance(child, ast.Call):
            target = child.func
            name = (
                target.attr
                if isinstance(target, ast.Attribute)
                else getattr(target, "id", "")
            )
            # `assert_grantable(...)` 本身就是断言：它的契约是「不抛」
            if name in {"raises", "warns", "approx"} or name.startswith(
                "assert"
            ):
                return True
    return False


def check_test_names_state_a_contract() -> list[Violation]:
    """测试名写断言的契约，不写来历——来历 git 已经记着了。"""
    found: list[Violation] = []
    for path in _python_tests():
        tree = parse(path)
        if tree is None:
            continue
        for node in _test_functions(tree):
            words = set(node.name.lower().split("_"))
            if words & PROVENANCE_WORDS or PROVENANCE_TEXT.search(node.name):
                found.append(
                    Violation(
                        "测试名不写来历", at(path, node.lineno), node.name
                    )
                )
    found.extend(_ts_test_names())
    return found


def _ts_test_names() -> list[Violation]:
    found: list[Violation] = []
    title = re.compile(r"\b(?:it|test)\s*\(\s*['\"`](?P<name>[^'\"`]+)")
    for path in web_tests():
        for number, line in enumerate(read(path).splitlines(), start=1):
            match = title.search(line)
            if match is None:
                continue
            if PROVENANCE_TEXT.search(match.group("name")):
                found.append(
                    Violation(
                        "测试名不写来历",
                        at(path, number),
                        match.group("name")[:40],
                    )
                )
    return found


def check_no_skips_outside_conftest() -> list[Violation]:
    """`pytest.skip` 只用于环境能力缺失，且只允许写在 conftest 里。

    ⚠ 用它掩盖「这条一直失败」，等于把红灯改成绿灯。
    """
    found: list[Violation] = []
    for path in _python_tests():
        if path.name == "conftest.py":
            continue
        for number, line in enumerate(read(path).splitlines(), start=1):
            if "pytest.skip" in line or "@pytest.mark.skip" in line:
                found.append(
                    Violation(
                        "测试里不许 skip",
                        at(path, number),
                        "环境能力缺失写在 conftest，其余一律修或删",
                    )
                )
    return found


def check_xfail_is_strict() -> list[Violation]:
    """非 strict 的 xfail 会让「意外通过」也算绿。"""
    found: list[Violation] = []
    for path in _python_tests():
        text = read(path)
        for number, line in enumerate(text.splitlines(), start=1):
            if "xfail" in line and "strict=True" not in line:
                found.append(
                    Violation(
                        "xfail 必须 strict=True",
                        at(path, number),
                        line.strip()[:60],
                    )
                )
    return found


def check_python_tests_have_docstring() -> list[Violation]:
    """测试文件头一到三行锁定这个文件在守什么契约。"""
    found: list[Violation] = []
    for path in _python_tests():
        if path.name == "__init__.py":
            continue
        tree = parse(path)
        if tree is None or ast.get_docstring(tree):
            continue
        found.append(
            Violation(
                "测试文件缺模块 docstring",
                at(path),
                "写清这个文件在守什么契约",
            )
        )
    return found


def check_python_tests_are_layered() -> list[Violation]:
    """四层职责不重叠：用例必须落在 unit/integration/contract/e2e 之一。"""
    found: list[Violation] = []
    for path in _python_tests():
        if path.name in {"conftest.py", "__init__.py"}:
            continue
        parts = set(path.parts)
        if not parts & LAYERS:
            found.append(
                Violation(
                    "测试必须放进分层目录",
                    at(path),
                    "tests/{unit,integration,contract,e2e}/",
                )
            )
    return found


def _balanced(text: str, start: int) -> int:
    """从 `(` 起找到配对的 `)`，返回其后一位；找不到返回 -1。

    ⚠ 必须跳过字符串字面量里的括号。用例名里出现不配对的括号是常事
    （`'取值落在 [0, 1)'`、`'名字(带括号)的情形'`），把它们算进深度会有两种
    后果，且都是静默的：多一个 `)` 时用例体在名字处就截断，那条用例被判成
    「没有断言」；多一个 `(` 时反而会**越过**用例体一路吞到后面，借到别的
    用例的断言——于是一条真的没有断言的用例安然过闸。

    Args: text, start。
    """
    depth = 0
    quote = ""
    index = start
    while index < len(text):
        char = text[index]
        if quote:
            # 反斜杠转义：跳过下一个字符，免得 `'\\''` 这种把引号数错
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = ""
        elif char in {"'", '"', "`"}:
            quote = char
        else:
            depth += char == "("
            depth -= char == ")"
            if depth == 0:
                return index + 1
        index += 1
    return -1


def _case_blocks(text: str) -> list[tuple[int, str]]:
    """按括号配对切出每个用例体（行号, 正文）。

    ⚠ `it.each(表)(名, 体)` 的用例体在**第二个**括号组里，扫第一个只会
    拿到数据表，于是每条表驱动用例都被判成没有断言。
    """
    found: list[tuple[int, str]] = []
    for match in TS_CASE.finditer(text):
        cursor = text.index("(", match.end() - 1)
        if match.group("each"):
            cursor = _balanced(text, cursor)
            if cursor < 0 or text[cursor : cursor + 1] != "(":
                continue
        end = _balanced(text, cursor)
        if end < 0:
            continue
        line = text.count("\n", 0, match.start()) + 1
        found.append((line, text[cursor:end]))
    return found


def check_ts_tests_assert_something() -> list[Violation]:
    """挂载一个组件不写任何断言就能拿到很高的覆盖率数字。"""
    found: list[Violation] = []
    for path in web_tests():
        text = read(path)
        for line, body in _case_blocks(text):
            if any(mark in body for mark in ASSERTIONS):
                continue
            found.append(
                Violation("测试必须有断言", at(path, line), body[:50].strip())
            )
    return found


def check_ts_test_hygiene() -> list[Violation]:
    """禁 `.only`（会静默跳过同文件其余用例）、禁 skip、禁大颗粒快照。"""
    found: list[Violation] = []
    rules = (
        (TS_FOCUS, ".only 会让同文件其余用例静默不跑"),
        (TS_SKIP, "skip 掉的用例等于没有；修或删"),
        (BIG_SNAPSHOT, "大颗粒快照证明不了契约，用显式断言"),
        (SLEEP_WAIT, "用显式完成信号，不要靠 setTimeout 等"),
    )
    for path in web_tests():
        for number, line in enumerate(read(path).splitlines(), start=1):
            for pattern, reason in rules:
                if pattern.search(line):
                    found.append(
                        Violation("测试写法不合规", at(path, number), reason)
                    )
    return found


def check_the_case_splitter_survives_brackets_in_names() -> list[Violation]:
    """本闸自检：切用例体时不许把名字里的括号算进配对深度。

    ⚠ 这条守的是**上面那条闸自己**。`_balanced` 一旦把字符串里的括号算进去，
    表现分两种、都静默：名字里多一个 `)` 会让用例体在名字处截断，那条用例被
    误判成没有断言；多一个 `(` 则会越过用例体一路吞到后面，**借到别的用例的
    断言**——于是真正没有断言的用例安然过闸，而这道闸的全部意义就是拦它。
    """
    cases = (
        ("it('取值落在 [0, 1)', () => { expect(v).toBe(1) })", True),
        ("it('名字带一个 ( 括号', () => { expect(v).toBe(1) })", True),
        ("it('什么都不断言', () => { mount(Thing) })", False),
    )
    found: list[Violation] = []
    for source, wants_assertion in cases:
        blocks = _case_blocks(source)
        detected = bool(blocks) and any(
            mark in blocks[0][1] for mark in ASSERTIONS
        )
        if detected is not wants_assertion:
            found.append(
                Violation(
                    "用例体切分被名字里的括号带歪",
                    at(Path(__file__)),
                    source[:40],
                )
            )
    return found


def check_the_case_splitter_ignores_member_calls() -> list[Violation]:
    """本闸自检：`RE.test(x)` 这类成员调用不是用例。

    ⚠ 认成用例之后，被切走的那一段里没有断言，于是凭空多出一条「测试必须有
    断言」——而它指的行根本不是用例，写测试的人只能靠改写无关代码来绕开。
    """
    not_cases = (
        "const ok = PATTERN.test(name)",
        "if (new RegExp(x).test(source)) return",
        "suite.it(name)",
    )
    found: list[Violation] = []
    for source in not_cases:
        if _case_blocks(source):
            found.append(
                Violation(
                    "成员调用被误认成用例",
                    at(Path(__file__)),
                    source[:40],
                )
            )
    # 真用例仍要认得出来，别把上面那条挡过头
    if not _case_blocks("it('真用例', () => { expect(1).toBe(1) })"):
        found.append(
            Violation("挡过头了，真用例也认不出", at(Path(__file__)), "it(...)")
        )
    return found


CHECKS = (
    check_python_tests_assert_something,
    check_test_names_state_a_contract,
    check_no_skips_outside_conftest,
    check_xfail_is_strict,
    check_python_tests_have_docstring,
    check_python_tests_are_layered,
    check_ts_tests_assert_something,
    check_ts_test_hygiene,
    check_the_case_splitter_survives_brackets_in_names,
    check_the_case_splitter_ignores_member_calls,
)


if __name__ == "__main__":
    raise SystemExit(main("测试质量检查", CHECKS))
