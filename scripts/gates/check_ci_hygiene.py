#!/usr/bin/env python3
"""供应链与仓库卫生闸：engineering-workflow.md §5.4、§6.1，docker-build.md §6。

⚠ 第三方 Action 按 tag 固定等于任意代码执行——tag 可以被重新指向。
⚠ `latest` 让「线上跑的到底是哪个版本」变成不可回答的问题，回滚也就不可能。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from _report import (
    PY,
    ROOT,
    FuncDef,
    Violation,
    at,
    functions,
    iter_files,
    main,
    parse,
    read,
    run_git,
)

WORKFLOWS = ROOT / ".github" / "workflows"
GATES = ROOT / "scripts" / "gates"
LOCKFILES = ("server/uv.lock", "web/pnpm-lock.yaml")

USES = re.compile(r"^\s*(?:-\s*)?uses:\s*(?P<ref>\S+)")
PINNED = re.compile(r"^[\w.-]+/[\w.-]+(?:/[\w.-]+)*@[0-9a-f]{40}$")
LOCAL_ACTION = re.compile(r"^\./")
DOCKER_IMAGE = re.compile(r"^\s*(?:FROM|image:)\s+(?P<image>[\w./-]+:?[\w.-]*)")
# 重试会把不确定性藏起来；测试偶发失败一律按 P1 缺陷处理
RETRY_MARKERS = re.compile(
    r"continue-on-error:\s*true|nick-fields/retry|retry-on-failure|--reruns"
)
YAML = frozenset({".yml", ".yaml"})


def _workflows() -> list[Path]:
    return list(iter_files(WORKFLOWS, YAML))


def _tracked_files() -> set[str]:
    return set(run_git("ls-files").splitlines())


def check_actions_are_pinned_by_sha() -> list[Violation]:
    """第三方 Action 按 commit SHA 固定，不按 tag。"""
    found: list[Violation] = []
    for path in _workflows():
        for number, line in enumerate(read(path).splitlines(), start=1):
            match = USES.match(line)
            if match is None:
                continue
            reference = match.group("ref").strip("'\"")
            if LOCAL_ACTION.match(reference) or PINNED.match(reference):
                continue
            found.append(
                Violation(
                    "Action 必须按 commit SHA 固定",
                    at(path, number),
                    f"{reference}；tag 可被重新指向",
                )
            )
    return found


def check_no_latest_tag() -> list[Violation]:
    """镜像 tag 用版本号 + commit SHA，不用 `latest`。"""
    found: list[Violation] = []
    targets = [*_workflows(), *_dockerfiles(), *_compose_files()]
    for path in targets:
        for number, line in enumerate(read(path).splitlines(), start=1):
            match = DOCKER_IMAGE.match(line)
            if match is None:
                continue
            image = match.group("image")
            if image.endswith(":latest") or ":" not in image.split("/")[-1]:
                found.append(
                    Violation(
                        "镜像必须钉住版本，不许 latest",
                        at(path, number),
                        image,
                    )
                )
    return found


def _dockerfiles() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("Dockerfile*")
        if path.is_file() and "node_modules" not in path.parts
    )


def _compose_files() -> list[Path]:
    return sorted((ROOT / "docker").glob("compose*.y*ml"))


def check_lockfiles_are_committed() -> list[Violation]:
    """`uv.lock` 与 `pnpm-lock.yaml` 必须提交，CI 用 `--frozen` 安装。"""
    tracked = _tracked_files()
    return [
        Violation("锁文件必须提交进仓", at(ROOT / name), name)
        for name in LOCKFILES
        if name not in tracked
    ]


def check_no_secret_files_tracked() -> list[Violation]:
    """`.env` 不进版本库——模板是 `.env.example`，那份可以提交。"""
    return [
        Violation("密钥文件不许进版本库", at(ROOT / name), name)
        for name in sorted(_tracked_files())
        if Path(name).name.startswith(".env")
        and not Path(name).name.endswith((".example", ".template"))
    ]


def check_images_run_as_non_root() -> list[Violation]:
    """镜像不以 root 运行，且不把 `.env` 烘进镜像层。

    ⚠ 镜像层不可删除：某层 COPY 进来、后层 rm 掉，文件仍在历史层里可被提取。
    """
    found: list[Violation] = []
    for path in _dockerfiles():
        text = read(path)
        if not re.search(r"^USER\s+(?!root)", text, re.MULTILINE):
            found.append(
                Violation("镜像必须以非 root 运行", at(path), "缺 USER 指令")
            )
        if re.search(r"^COPY[^\n]*\.env", text, re.MULTILINE):
            found.append(
                Violation(
                    "镜像里不许出现 .env", at(path), "配置走运行时环境变量"
                )
            )
    return found


def check_ci_has_no_retries() -> list[Violation]:
    """CI 不配置自动重试——重试会把不确定性藏起来。"""
    found: list[Violation] = []
    for path in _workflows():
        for number, line in enumerate(read(path).splitlines(), start=1):
            match = RETRY_MARKERS.search(line)
            if match is not None:
                found.append(
                    Violation(
                        "CI 不许配置自动重试",
                        at(path, number),
                        f"{match.group(0)}；偶发失败按 P1 缺陷处理",
                    )
                )
    return found


def check_every_push_is_covered() -> list[Violation]:
    """至少有一条流水线在每次 push 上跑，否则闸门只是约定。"""
    if not WORKFLOWS.is_dir():
        return [Violation("缺 .github/workflows", at(ROOT), "CI 必须存在")]
    for path in _workflows():
        text = read(path)
        if re.search(r"^on:", text, re.MULTILINE) and "push:" in text:
            return []
    return [
        Violation(
            "必须有 push 触发的流水线",
            at(WORKFLOWS),
            "只在 PR 上跑等于放过直推与分支上的红灯",
        )
    ]


def _is_subprocess_run(call: ast.Call) -> bool:
    """这次调用是不是 `subprocess.run`。

    Args: call。
    """
    func = call.func
    return (
        isinstance(func, ast.Attribute)
        and func.attr == "run"
        and isinstance(func.value, ast.Name)
        and func.value.id == "subprocess"
    )


def _checks_by_flag(call: ast.Call) -> bool:
    """这次调用显式传了 `check=True`，失败会自己抛。

    Args: call。
    """
    return any(
        keyword.arg == "check"
        and isinstance(keyword.value, ast.Constant)
        and keyword.value.value is True
        for keyword in call.keywords
    )


def _swallows_failure(node: FuncDef) -> bool:
    """跑了外部命令，却既没 `check=True` 也没读 `returncode`。

    Args: node。
    """
    calls = [
        child
        for child in ast.walk(node)
        if isinstance(child, ast.Call) and _is_subprocess_run(child)
    ]
    if not calls or all(_checks_by_flag(call) for call in calls):
        return False
    return not any(
        isinstance(child, ast.Attribute) and child.attr == "returncode"
        for child in ast.walk(node)
    )


def check_gates_do_not_swallow_command_failures() -> list[Violation]:
    """闸门跑外部命令必须查退出码。

    ⚠ 吞掉失败的方向是**假绿**：`git ls-files` 挂掉时返回空集合，
    「.env 不许进版本库」这类遍历式检查就变成遍历空集合、无条件通过。
    worktree 里跑 act 就会真实触发——容器里 `.git` 指向宿主机路径。
    """
    found: list[Violation] = []
    for path in iter_files(GATES, PY):
        tree = parse(path)
        if tree is None:
            continue
        found.extend(
            Violation(
                "闸门吞掉外部命令的失败", at(path, node.lineno), node.name
            )
            for node in functions(tree)
            if _swallows_failure(node)
        )
    return found


CHECKS = (
    check_actions_are_pinned_by_sha,
    check_no_latest_tag,
    check_lockfiles_are_committed,
    check_no_secret_files_tracked,
    check_images_run_as_non_root,
    check_ci_has_no_retries,
    check_every_push_is_covered,
    check_gates_do_not_swallow_command_failures,
)


if __name__ == "__main__":
    raise SystemExit(main("供应链与仓库卫生检查", CHECKS))
