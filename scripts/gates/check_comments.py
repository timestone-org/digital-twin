#!/usr/bin/env python3
"""注释闸：comment-style-python.md 与 comment-style-typescript.md。

注释只做四件事。这里拦的是最常见的两种坏法：把 git 已经记着的变更史
写进源码（下一次提交落地时它就是错的），以及用文字复述类型签名。
"""

from __future__ import annotations

import re
from pathlib import Path

from _report import (
    PY,
    TS,
    Violation,
    at,
    comment_lines,
    iter_files,
    main,
    python_comments,
    python_prose,
    python_sources,
    python_test_roots,
    read,
    web_sources,
    web_tests,
)

# 变更史叙事：git 已经记着了，而且下一次提交落地时这句话就是错的
CHANGE_HISTORY = re.compile(
    r"改造前|改造后|重构前|重构后|原先|之前是|以前是|曾经|本轮新增"
    r"|旧实现|老实现|原实现|现在改成|后来改成|历史遗留|早期版本"
    r"|previously|used to be|formerly|refactored from|legacy behaviou?r"
)
# git log 与 git blame 已经准确回答了，而且不会过期
AUTHOR_BLOCK = re.compile(
    r"@author\b|@date\b|Author\s*[:：]|Email\s*[:：]|Created by"
    r"|LastUpdate|Last Modified|最后更新|创建日期|创建人|作者\s*[:：]"
)
# 文件长到需要分区，就该拆文件
BANNER = re.compile(r"^(?:#|//|\*)\s*[=\-*~#]{6,}")
# 类型的唯一真源是签名，写两份必然漂移
JSDOC_TYPE = re.compile(r"@(?:param|returns?|type)\s+\{")
TS_IGNORE = re.compile(r"@ts-ignore\b")
TS_EXPECT = re.compile(r"@ts-expect-error(?P<rest>.*)")
# 注释掉的死代码直接删，不要搬家
DEAD_CODE = re.compile(
    r"^//\s*(const|let|var|function|import|export|return|await|if\s*\()\b"
)
FILEOVERVIEW = "@fileoverview"


def _python_files() -> list[Path]:
    found = list(python_sources())
    for root in python_test_roots():
        found.extend(iter_files(root, PY))
    return found


def _ts_files() -> list[Path]:
    return [*web_sources(), *web_tests()]


def _all_comments() -> list[tuple[Path, int, str]]:
    found: list[tuple[Path, int, str]] = []
    for path in _python_files():
        found.extend((path, line, text) for line, text in python_comments(path))
    for path in _ts_files():
        found.extend((path, line, text) for line, text in comment_lines(path))
    return found


def _all_prose() -> list[tuple[Path, int, str]]:
    """注释 + Python docstring：注释规范同样管 docstring。"""
    found: list[tuple[Path, int, str]] = []
    for path in _python_files():
        found.extend((path, line, text) for line, text in python_prose(path))
    for path in _ts_files():
        found.extend((path, line, text) for line, text in comment_lines(path))
    return found


def check_no_change_history() -> list[Violation]:
    """禁止变更史叙事——注释写当前约束及其后果，不写它的来历。"""
    return [
        Violation("禁止变更史注释", at(path, line), found.group(0))
        for path, line, text in _all_prose()
        if (found := CHANGE_HISTORY.search(text)) is not None
    ]


def check_no_author_block() -> list[Violation]:
    """手工维护的作者与更新时间头块一律不写。"""
    found: list[Violation] = []
    for path, line, text in _all_comments():
        match = AUTHOR_BLOCK.search(text)
        if match is not None:
            found.append(
                Violation(
                    "禁止手工维护的作者/日期头块",
                    at(path, line),
                    match.group(0),
                )
            )
    return found


def check_no_banner() -> list[Violation]:
    """禁止分隔用的 ASCII 大横幅。"""
    found: list[Violation] = []
    for path, line, text in _all_comments():
        if BANNER.match(text.strip()):
            found.append(
                Violation(
                    "禁止 ASCII 大横幅", at(path, line), text.strip()[:40]
                )
            )
    return found


def check_no_jsdoc_types() -> list[Violation]:
    """TS 里不写 JSDoc 类型标注——类型的唯一真源是签名。"""
    found: list[Violation] = []
    for path, line, text in _all_comments():
        if path.suffix == ".py":
            continue
        match = JSDOC_TYPE.search(text)
        if match is not None:
            found.append(
                Violation(
                    "TS 不写 JSDoc 类型标注", at(path, line), match.group(0)
                )
            )
    return found


def check_ts_suppressions() -> list[Violation]:
    """`@ts-ignore` 禁止；`@ts-expect-error` 必须跟一句为什么这里预期报错。"""
    found: list[Violation] = []
    for path, line, text in _all_comments():
        if path.suffix == ".py":
            continue
        if TS_IGNORE.search(text):
            found.append(
                Violation(
                    "禁止 @ts-ignore",
                    at(path, line),
                    "用 @ts-expect-error + 理由，它在错误消失后会自己报错",
                )
            )
        expect = TS_EXPECT.search(text)
        if expect is not None and not expect.group("rest").strip():
            found.append(
                Violation(
                    "@ts-expect-error 必须写理由",
                    at(path, line),
                    text.strip()[:40],
                )
            )
    return found


def check_no_commented_out_code() -> list[Violation]:
    """注释掉的死代码直接删——git 已经记着了。"""
    found: list[Violation] = []
    for path, line, text in _all_comments():
        if path.suffix != ".py" and DEAD_CODE.match(text.strip()):
            found.append(
                Violation(
                    "禁止注释掉的死代码", at(path, line), text.strip()[:40]
                )
            )
    return found


def check_ts_files_have_fileoverview() -> list[Violation]:
    """每个 TS/Vue 源文件都要有一行说清它是什么。

    ⚠ 桶文件与类型声明文件除外：前者只做转出，后者没有「做什么」可说。
    """
    found: list[Violation] = []
    for path in web_sources():
        if path.name == "index.ts" or path.name.endswith(".d.ts"):
            continue
        if FILEOVERVIEW not in read(path):
            found.append(
                Violation(
                    "TS/Vue 文件头缺 @fileoverview",
                    at(path),
                    "一到三行说清这个文件是什么",
                )
            )
    return found


def check_ts_tests_state_their_contract() -> list[Violation]:
    """测试文件头一到三行锁定这个文件在守什么契约。"""
    return [
        Violation(
            "测试文件头缺 @fileoverview",
            at(path),
            "写清这个文件在守什么契约",
        )
        for path in iter_files_of_tests()
        if FILEOVERVIEW not in read(path)
    ]


def iter_files_of_tests() -> list[Path]:
    return [path for path in web_tests() if path.suffix in TS]


CHECKS = (
    check_no_change_history,
    check_no_author_block,
    check_no_banner,
    check_no_jsdoc_types,
    check_ts_suppressions,
    check_no_commented_out_code,
    check_ts_files_have_fileoverview,
    check_ts_tests_state_their_contract,
)


if __name__ == "__main__":
    raise SystemExit(main("注释规范检查", CHECKS))
