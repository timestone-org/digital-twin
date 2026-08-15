#!/usr/bin/env python3
"""TS/Vue 风格闸：code-style-typescript.md §3、§5、§6.3、§8、§10。

这一节的缺陷大部分**不会报错**，只会表现为「偶尔不更新」或「越用越卡」：
卸载不清理的定时器让大屏开几天就吃满内存，索引做 key 让删中间一项后
其余整体错位，而硬编码色值在换肤时第一个露馅。
"""

from __future__ import annotations

import re
from pathlib import Path

from _report import (
    STYLE,
    Violation,
    at,
    iter_files,
    main,
    read,
    strip_ts_comments,
    web_members,
    web_sources,
)

MAX_SFC_LINES = 300
MAX_COMPOSABLE_LINES = 200
MAX_PROPS = 10
# ⚠ 不是 4：§4.2 强制的 `AppShell > 页面根 > DtCard > DtDataView` 已占满 4 层，
# 取 4 会让这两条规范互相排斥。6 层给页面自己的标记留两层。
MAX_TEMPLATE_DEPTH = 6

TOKENS_PACKAGE = "tokens"
# 生命周期长于渲染的东西，都必须在卸载时清理
LONG_LIVED = re.compile(
    r"\bsetInterval\s*\(|\bsetTimeout\s*\(|addEventListener\s*\("
    r"|new\s+(?:Resize|Intersection|Mutation)Observer|echarts\.init"
    r"|new\s+WebSocket"
)
CLEANUP = re.compile(
    r"onUnmounted|onBeforeUnmount|onScopeDispose|useEventListener"
)
# 用索引做 key 会让「删除中间一项」变成「最后一项消失、其余全部错位」
INDEX_KEY = re.compile(r""":key\s*=\s*["'](?:index|idx|i)["']""")
# 时区与格式会散落成十几种，格式化必须集中在一处
INLINE_FORMAT = re.compile(
    r"toLocaleString\s*\(|toLocaleDateString\s*\(|new Date\s*\("
)
# 主题切换时硬编码色是第一个出问题的地方
HARDCODED_COLOR = re.compile(
    r"#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(\s*\d|\bhsla?\s*\(\s*\d"
)
DEFINE_PROPS = re.compile(r"defineProps<\{(?P<body>[\s\S]*?)\}>")
STYLE_BLOCK = re.compile(r"<style[^>]*>(?P<body>[\s\S]*?)</style>")
TEMPLATE_BLOCK = re.compile(
    r"<template>(?P<body>[\s\S]*?)</template>\s*(?=<script|<style|$)"
)
OPEN_TAG = re.compile(
    r"<(?P<name>[A-Za-z][\w.-]*)(?P<attrs>[^>]*?)(?P<self>/?)>"
)
CLOSE_TAG = re.compile(r"</(?P<name>[A-Za-z][\w.-]*)>")
VOID_TAGS = frozenset({"br", "hr", "img", "input", "source", "use", "path"})
# ⚠ 这些不是 DOM 层级：`<template>` 只是插槽与 v-if 的载体，`<slot>` 是内容
# 的占位、自己不落节点，Teleport / Transition 也不渲染自己的节点。
# 把它们算进嵌套会让「拆子组件」变成无解。
TRANSPARENT_TAGS = frozenset(
    {
        "template",
        "slot",
        "Teleport",
        "Transition",
        "TransitionGroup",
        "KeepAlive",
    }
)


def _components() -> list[Path]:
    return [path for path in web_sources() if path.suffix == ".vue"]


def _composables() -> list[Path]:
    return [
        path
        for path in web_sources()
        if path.suffix == ".ts" and path.name.startswith("use")
    ]


def check_component_size() -> list[Violation]:
    """单文件组件 ≤300 行，组合式函数 ≤200 行。

    ⚠ 超了几乎总是因为逻辑写在了组件里——组合式函数能被独立单元测试，
    组件只能被挂载测试。
    """
    found: list[Violation] = []
    limits = (
        (_components(), MAX_SFC_LINES),
        (_composables(), MAX_COMPOSABLE_LINES),
    )
    for paths, limit in limits:
        for path in paths:
            lines = len(read(path).splitlines())
            if lines > limit:
                found.append(
                    Violation(
                        f"不许超过 {limit} 行",
                        at(path),
                        f"{lines} 行；逻辑抽进组合式函数或拆子组件",
                    )
                )
    return found


def check_props_count() -> list[Violation]:
    """props ≤10 个，相关的聚成一个对象 prop。"""
    found: list[Violation] = []
    for path in _components():
        match = DEFINE_PROPS.search(read(path))
        if match is None:
            continue
        count = len(
            [
                line
                for line in match.group("body").splitlines()
                if re.match(r"\s*[A-Za-z_$][\w$]*\??\s*:", line)
            ]
        )
        if count > MAX_PROPS:
            found.append(
                Violation(
                    f"props 不许超过 {MAX_PROPS} 个",
                    at(path),
                    f"{count} 个；相关的聚成一个对象 prop",
                )
            )
    return found


def _template_depth(body: str) -> int:
    depth = 0
    deepest = 0
    for token in re.finditer(r"<[^>]+>", body):
        text = token.group(0)
        close = CLOSE_TAG.fullmatch(text)
        if close is not None:
            if close.group("name") not in TRANSPARENT_TAGS:
                depth = max(depth - 1, 0)
            continue
        opened = OPEN_TAG.fullmatch(text)
        if opened is None or opened.group("self"):
            continue
        name = opened.group("name")
        if name in VOID_TAGS or name in TRANSPARENT_TAGS:
            continue
        depth += 1
        deepest = max(deepest, depth)
    return deepest


def check_template_nesting() -> list[Violation]:
    """模板嵌套 ≤4 层，超了拆子组件。"""
    found: list[Violation] = []
    for path in _components():
        match = TEMPLATE_BLOCK.search(read(path))
        if match is None:
            continue
        depth = _template_depth(match.group("body"))
        if depth > MAX_TEMPLATE_DEPTH:
            found.append(
                Violation(
                    f"模板嵌套不许超过 {MAX_TEMPLATE_DEPTH} 层",
                    at(path),
                    f"{depth} 层；拆子组件",
                )
            )
    return found


def check_v_for_key_is_stable() -> list[Violation]:
    """`v-for` 的 key 用业务 id，不用数组索引。"""
    found: list[Violation] = []
    for path in _components():
        for number, line in enumerate(read(path).splitlines(), start=1):
            if INDEX_KEY.search(line):
                found.append(
                    Violation(
                        "v-for 的 key 不许用索引",
                        at(path, number),
                        "删中间一项会让其余整体错位、本地状态串行",
                    )
                )
    return found


COMPOSABLE_BODY = re.compile(r"export function use[A-Z]\w*\([\s\S]*")


def _owned_scope(path: Path) -> str:
    """组件/组合式函数**自己**创建资源的那段代码。

    ⚠ 模块级单例（toast 队列这类）不在此列：它有自己的显式 clear()，
    不是每个组件各持一份，按组件卸载去清反而会把别人的消息一起清掉。
    """
    text = strip_ts_comments(read(path))
    if path.suffix == ".vue":
        return text
    match = COMPOSABLE_BODY.search(text)
    return match.group(0) if match else ""


def check_unmount_cleans_up() -> list[Violation]:
    """⚠ 大屏一开就是几天，一次泄漏会持续累积。"""
    found: list[Violation] = []
    for path in [*_components(), *_composables()]:
        text = _owned_scope(path)
        if LONG_LIVED.search(text) and not CLEANUP.search(text):
            found.append(
                Violation(
                    "卸载必须清理",
                    at(path),
                    "定时器 / 监听 / Observer / 实例都要在 onUnmounted 里释放",
                )
            )
    return found


def check_formatting_is_centralised() -> list[Violation]:
    """时间与数字的格式化集中在一处，组件只调用。"""
    found: list[Violation] = []
    for path in _components():
        text = strip_ts_comments(read(path))
        match = INLINE_FORMAT.search(text)
        if match is not None:
            found.append(
                Violation(
                    "组件里不许就地格式化时间",
                    at(path),
                    f"{match.group(0)}；走统一的格式化函数",
                )
            )
    return found


def _style_bodies(path: Path) -> list[str]:
    text = read(path)
    if path.suffix in STYLE:
        return [text]
    return [match.group("body") for match in STYLE_BLOCK.finditer(text)]


def check_no_hardcoded_colors() -> list[Violation]:
    """设计值一律来自 `@dt/tokens`，组件内不写硬编码色值。"""
    found: list[Violation] = []
    for path in _styled_files():
        if TOKENS_PACKAGE in path.parts:
            continue
        for body in _style_bodies(path):
            match = HARDCODED_COLOR.search(strip_ts_comments(body))
            if match is not None:
                found.append(
                    Violation(
                        "禁止硬编码色值",
                        at(path),
                        f"{match.group(0)}；用 var(--…)",
                    )
                )
    return found


def _styled_files() -> list[Path]:
    found = list(_components())
    for member in web_members():
        found.extend(iter_files(member / "src", STYLE))
    return found


CHECKS = (
    check_component_size,
    check_props_count,
    check_template_nesting,
    check_v_for_key_is_stable,
    check_unmount_cleans_up,
    check_formatting_is_centralised,
    check_no_hardcoded_colors,
)


if __name__ == "__main__":
    raise SystemExit(main("TS/Vue 风格检查", CHECKS))
