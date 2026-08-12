#!/usr/bin/env python3
"""PR 规模与提交约定闸：engineering-workflow.md §1–§3、§5.2。

评审质量随 PR 规模断崖式下降：超过几百行之后，评审就从「逐行看」退化为
「看起来没问题」，而那正是缺陷溜进去的方式。锁文件混在逻辑改动里同理——
几千行 diff 没人看，那正是供应链攻击的藏身处。

用法：`check_pr_policy.py <base-ref> [head-ref]`。
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from _report import Violation, main, run_git

MAX_CHANGED_LINES = 400
MAX_CHANGED_FILES = 20
MAX_SERVICES = 1

COMMIT_TYPES = (
    "feat",
    "fix",
    "refactor",
    "perf",
    "test",
    "docs",
    "build",
    "chore",
)
COMMIT_SUBJECT = re.compile(
    rf"^(?:{'|'.join(COMMIT_TYPES)})(?:\([\w./-]+\))?!?: \S.+"
)
BRANCH = re.compile(rf"^(?:{'|'.join(COMMIT_TYPES)})/[\w./-]+$")
# 机械化的大范围改动（重命名、格式化、自动生成）可以超限，但必须单独成 PR
MECHANICAL = re.compile(r"\[(?:机械|mechanical)]", re.IGNORECASE)
LOCKFILES = frozenset({"server/uv.lock", "web/pnpm-lock.yaml"})
# 锁文件的变更由清单文件引起，两者必须一起评审才看得懂
MANIFESTS = frozenset({"pyproject.toml", "package.json"})
# 生成物不计入评审规模
GENERATED = ("openapi.json", "/dist/", "/coverage/")
# `git diff --numstat` 每行是「新增\t删除\t路径」
NUMSTAT_FIELDS = 3
# `server/services/<svc>/…` —— 取服务名要有三段以上
SERVICE_PATH_DEPTH = 2
BASE_ARG = 2
HEAD_ARG = 3


def _git(*args: str) -> str:
    """跑一条 git 并取标准输出。失败由 run_git 抛出，见那里的理由。

    Args: *args。
    """
    return run_git(*args).strip()


def _base() -> str:
    if len(sys.argv) >= BASE_ARG:
        return sys.argv[1]
    return os.environ.get("PR_BASE_REF", "origin/main")


def _head() -> str:
    if len(sys.argv) >= HEAD_ARG:
        return sys.argv[2]
    return os.environ.get("PR_HEAD_REF", "HEAD")


def _range() -> str:
    return f"{_base()}...{_head()}"


def _changed_files() -> list[str]:
    output = _git("diff", "--name-only", _range())
    return [line for line in output.splitlines() if line]


def _reviewable(name: str) -> bool:
    return name not in LOCKFILES and not any(
        marker in f"/{name}" for marker in GENERATED
    )


def _changed_lines() -> int:
    total = 0
    for line in _git("diff", "--numstat", _range()).splitlines():
        parts = line.split("\t")
        if len(parts) != NUMSTAT_FIELDS or not _reviewable(parts[2]):
            continue
        added, removed = parts[0], parts[1]
        total += int(added or 0) + int(removed or 0)
    return total


def _is_mechanical() -> bool:
    return bool(MECHANICAL.search(os.environ.get("PR_TITLE", "")))


def _new_code_unit() -> str | None:
    """本次改动首次为某个代码单元落下源码；否则返回 None。

    判据是 `server/services/<unit>/src/` 在 base 上不存在——**不看 PR 标题**，
    标题可以随手写，仓库历史不能。

    ⚠ 判的是 `src/` 而不是服务目录本身：新服务的文档与依赖层（pyproject、
    README、CONTEXT）会先于代码单独成 PR（锁文件纪律逼出来的顺序），那时
    目录已经存在，按目录判会让真正的落地提交拿不到豁免。
    """
    added = {
        Path(name).parts[2]
        for name in _git(
            "diff", "--diff-filter=A", "--name-only", _range()
        ).splitlines()
        if name.startswith("server/services/")
        and len(Path(name).parts) > SERVICE_PATH_DEPTH
    }
    fresh = {
        unit
        for unit in added
        if not _git(
            "ls-tree", "--name-only", _base(), f"server/services/{unit}/src/"
        )
    }
    return next(iter(fresh)) if len(fresh) == 1 else None


def _is_landing_commit() -> bool:
    """新代码单元的首次落地：全部可评审改动都在那个新目录里。

    ⚠ 这是 ADR-0006 的豁免，三条边界都由这个函数机械保证：
    只认 base 上不存在的服务目录（故一个单元只能用一次——第二个 PR 里
    它已经存在），且**只要有一个文件落在目录外就整体不豁免**（故触及
    既有单元的改动带不进来）。
    """
    unit = _new_code_unit()
    if unit is None:
        return False
    prefix = f"server/services/{unit}/"
    return all(
        name.startswith(prefix)
        for name in _changed_files()
        if _reviewable(name)
    )


def check_pr_size() -> list[Violation]:
    """改动 ≤400 行、≤20 个文件。超了就拆成多个 PR。

    两类例外：机械化改动（标题标记），以及新代码单元的首次落地提交
    （[ADR-0006](../../docs/adr/0006-opcua服务端独立成代码单元.md)）——
    后者不看标题，只看「是不是全部落在一个 base 上尚不存在的服务目录里」。
    """
    if _is_mechanical() or _is_landing_commit():
        return []
    files = [name for name in _changed_files() if _reviewable(name)]
    lines = _changed_lines()
    found: list[Violation] = []
    if lines > MAX_CHANGED_LINES:
        found.append(
            Violation(
                f"PR 改动不许超过 {MAX_CHANGED_LINES} 行",
                _range(),
                f"{lines} 行（不含锁文件与生成物）",
            )
        )
    if len(files) > MAX_CHANGED_FILES:
        found.append(
            Violation(
                f"PR 不许超过 {MAX_CHANGED_FILES} 个文件",
                _range(),
                f"{len(files)} 个",
            )
        )
    return found


def check_pr_touches_one_service() -> list[Violation]:
    """跨服务改动拆成「先加新的、后切换、再删旧的」多个 PR。"""
    services = {
        Path(name).parts[2]
        for name in _changed_files()
        if name.startswith("server/services/")
        and len(Path(name).parts) > SERVICE_PATH_DEPTH
    }
    if len(services) <= MAX_SERVICES:
        return []
    return [
        Violation(
            f"一个 PR 只许碰 {MAX_SERVICES} 个服务",
            _range(),
            "、".join(sorted(services)),
        )
    ]


def _accompanies_lockfile(name: str) -> bool:
    """可以与锁文件同批的文件：造成它的清单，以及不含逻辑的文档。

    ⚠ 这是允许清单不是排除清单——新增一种就要问一次「它会不会大到
    让评审者跳过锁文件的 diff」。

    Args: name。
    """
    return name.endswith(".md") or Path(name).name in MANIFESTS


def check_lockfile_stands_alone() -> list[Violation]:
    """⚠ 锁文件混在逻辑改动里时，评审者会直接跳过几千行 diff。

    挡的是「锁文件被代码淹没」，不是「锁文件旁边有别的文件」：清单是锁
    变更的**成因**，不和它一起看就无从判断依赖为什么变；文档不含逻辑。
    新增代码单元必然同时动清单与锁文件，一刀切会让新服务根本进不来。
    """
    files = set(_changed_files())
    touched = files & LOCKFILES
    others = {
        name
        for name in files - LOCKFILES
        if _reviewable(name) and not _accompanies_lockfile(name)
    }
    if not touched or not others:
        return []
    return [
        Violation(
            "锁文件必须单独成 PR",
            _range(),
            f"{sorted(touched)} 与另外 {len(others)} 个文件混在一起",
        )
    ]


def check_commit_messages() -> list[Violation]:
    """标题写做了什么，格式 `<类型>(<范围>): <一句话>`。"""
    subjects = _git("log", "--format=%s", f"{_base()}..{_head()}").splitlines()
    return [
        Violation(
            "提交信息格式不合规",
            "commit",
            f"{subject[:60]}；应为 <类型>(<范围>): <一句话>",
        )
        for subject in subjects
        if subject and not COMMIT_SUBJECT.match(subject)
    ]


def check_branch_name() -> list[Violation]:
    """分支命名 `<类型>/<简述>`，关联一个 issue。"""
    name = os.environ.get("PR_HEAD_BRANCH") or _git(
        "rev-parse", "--abbrev-ref", "HEAD"
    )
    if not name or name in {"HEAD", "main"} or BRANCH.match(name):
        return []
    return [
        Violation(
            "分支命名不合规",
            name,
            f"应为 {'/ '.join(COMMIT_TYPES)}/<简述>",
        )
    ]


CHECKS = (
    check_pr_size,
    check_pr_touches_one_service,
    check_lockfile_stands_alone,
    check_commit_messages,
    check_branch_name,
)


if __name__ == "__main__":
    raise SystemExit(main("PR 规模与提交约定检查", CHECKS))
