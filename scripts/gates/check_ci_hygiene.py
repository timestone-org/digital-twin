#!/usr/bin/env python3
"""供应链与仓库卫生闸：engineering-workflow.md §5.4、§6.1，docker-build.md §6。

⚠ 第三方 Action 按 tag 固定等于任意代码执行——tag 可以被重新指向。
⚠ `latest` 让「线上跑的到底是哪个版本」变成不可回答的问题，回滚也就不可能。
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from _report import ROOT, Violation, at, iter_files, main, read

WORKFLOWS = ROOT / ".github" / "workflows"
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
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return set(result.stdout.splitlines())


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


CHECKS = (
    check_actions_are_pinned_by_sha,
    check_no_latest_tag,
    check_lockfiles_are_committed,
    check_no_secret_files_tracked,
    check_images_run_as_non_root,
    check_ci_has_no_retries,
    check_every_push_is_covered,
)


if __name__ == "__main__":
    raise SystemExit(main("供应链与仓库卫生检查", CHECKS))
