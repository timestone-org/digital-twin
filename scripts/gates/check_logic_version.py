#!/usr/bin/env python3
"""动了抽取引擎就必须动 `LOGIC_VERSION`：docs/AC_STARTUP_DESIGN.md §5。

⚠ 开机事件的参数指纹只由抽取参数的取值与 `LOGIC_VERSION` 算出，代码不进指纹：
一次纯行为改动（判定换个写法、掩码多掩一种）指纹分毫不变，页面于是把按旧规则
算出来的那份数据当成当前的，屏幕上没有任何迹象。本仓已经漏过，只是那几次
恰好连带改了字段名，指纹才跟着变。

比的是两侧「去掉 `#` 注释之后」的内容差没差，不对源码求哈希：哈希一次格式化
就炸，而 +1 的代价是已有批次全部判为过期、要重跑一次全量抽取——为一条改过措辞
的注释付这个代价，这条闸一个月内就会被绕过，然后它什么也保护不了。注释改不了
抽取行为，所以去掉它不会漏报。
⚠ 只去 `#` 注释，**不去 docstring**：docstring 会被程序读走（帮助文本、契约
描述），把它当成散文一并抹掉就是一处静默的假阴性。

用法：`check_logic_version.py [<base-ref> [<head-ref>]]`，取基线同
`check_pr_policy.py`：命令行参数 > `PR_BASE_REF`/`PR_HEAD_REF` > `origin/main`。
"""

from __future__ import annotations

import re

from _report import (
    ROOT,
    Violation,
    diff_base,
    diff_head,
    diff_range,
    file_at,
    main,
    read,
    ref_exists,
    strip_python_comments,
)

_SERVICES = "server/services/platform-server/src/platform_server"
_ENGINE_DIR = f"{_SERVICES}/apps/hvac/services"
# 只有这两个文件决定抽出来的事件长什么样：判定状态机，与喂给它的帧怎么算。
# 取数、分片、批次生命周期改了不动判定口径，圈进来只会让这条闸天天误报，
# 而被无视的闸门等于没有闸门（docs/agents/ci-gates.md §2 领域不变量）
ENGINE_FILES = (
    f"{_ENGINE_DIR}/ac_startup_rules.py",
    f"{_ENGINE_DIR}/ac_startup_frames.py",
)
# 常量定义在判定状态机那一份里
VERSION_FILE = ENGINE_FILES[0]
VERSION = re.compile(r"^LOGIC_VERSION\s*=\s*(\d+)\s*$", re.M)

_BUMP = (
    f"把 {VERSION_FILE} 里的 LOGIC_VERSION +1"
    "（docs/AC_STARTUP_DESIGN.md §5）。"
    "⚠ +1 之后已有批次会全部判为过期，页面上提醒重新抽取——"
    "所以只有判定口径真的变了才 +1"
)


def _version(source: str) -> int | None:
    """从源码里读出 `LOGIC_VERSION` 的取值，读不出给 None。

    Args: source。
    """
    found = VERSION.search(source)
    return int(found.group(1)) if found else None


def check_logic_version_is_readable() -> list[Violation]:
    """`LOGIC_VERSION = <整数>` 必须在原处，且这条闸读得懂它。

    ⚠ 读不出取值时这条闸的表现是从此长绿，那比没有闸更糟——它坏的方式
    正是「一直绿」（docs/agents/ci-gates.md §3）。
    """
    path = ROOT / VERSION_FILE
    source = read(path) if path.is_file() else ""
    if _version(source) is not None:
        return []
    return [
        Violation(
            "闸门读不到 LOGIC_VERSION",
            VERSION_FILE,
            "必须是模块顶层的 `LOGIC_VERSION = <整数>`；换了写法这条闸就长绿",
        )
    ]


def _code_at(ref: str, path: str) -> str | None:
    """某个提交里这份文件去掉注释之后的代码；那时还没有它就给 None。

    Args: ref, path。
    """
    source = file_at(ref, path)
    return None if source is None else strip_python_comments(source)


def _changed_engine_files(base: str, head: str) -> list[str]:
    """两侧代码真的不一样的引擎文件；只改注释的不算。

    Args: base, head。
    """
    return [
        path
        for path in ENGINE_FILES
        if _code_at(base, path) != _code_at(head, path)
    ]


def check_engine_change_bumps_version() -> list[Violation]:
    """改了抽取引擎的这次改动，必须同时改掉 `LOGIC_VERSION` 的取值。"""
    base, head = diff_base(), diff_head()
    if not ref_exists(base):
        return [
            Violation(
                "比较基线解析不了",
                base,
                "先 `git fetch origin <目标分支>`；"
                "基线取不到时 git diff 只给空输出，这条闸会长绿",
            )
        ]
    before, after = file_at(base, VERSION_FILE), file_at(head, VERSION_FILE)
    if before is None or after is None:
        # 基线里还没有这个引擎：这次是把它整个加进来，没有可比的旧口径
        return []
    touched = _changed_engine_files(base, head)
    if not touched or _version(before) != _version(after):
        return []
    return [
        Violation(
            "改了抽取引擎却没改 LOGIC_VERSION",
            f"{diff_range()}：{'、'.join(touched)}",
            _BUMP,
        )
    ]


CHECKS = (
    check_logic_version_is_readable,
    check_engine_change_bumps_version,
)


if __name__ == "__main__":
    raise SystemExit(main("抽取逻辑版本检查", CHECKS))
