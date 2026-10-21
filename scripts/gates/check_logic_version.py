#!/usr/bin/env python3
"""抽取、范围或季节判定变化时必须升级 LOGIC_VERSION。

配置指纹不包含源码；版本闸避免代码语义变化后继续使用旧标签。
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
# 事件、帧、范围与季节的判定口径
ENGINE_FILES = (
    f"{_ENGINE_DIR}/ac_startup_rules.py",
    f"{_ENGINE_DIR}/ac_startup_frames.py",
    f"{_SERVICES}/apps/hvac/rooms.py",
    f"{_SERVICES}/apps/hvac/seasons.py",
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
