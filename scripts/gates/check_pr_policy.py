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
from pathlib import Path

from _report import (
    Violation,
    changed_files,
    diff_base,
    diff_head,
    diff_range,
    git,
    main,
)

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
# 大屏模块的两处落脚点
MODULES_SRC = "web/packages/modules/src/modules/"
MODULES_TESTS = "web/packages/modules/tests/modules/"
# `web/packages/modules/src/modules/<type>/<文件>` —— 取模块名要有七段
MODULE_PATH_DEPTH = 6
# 模块名在第几段
MODULE_NAME_INDEX = 5
# 注册一个模块必然要动的几处：前端两份花名册、服务端目录与它的两份花名册。
# ⚠ 这不是「顺手带进来的无关改动」，而是「一行注册」这一步本身
MODULE_REGISTRY = frozenset(
    {
        "web/packages/modules/tests/manifests.contract.spec.ts",
        "web/packages/modules/tests/registerBuiltins.test.ts",
        "server/services/platform-server/src/platform_server/apps/dashboard"
        "/module_types.json",
        "server/services/platform-server/tests/contract"
        "/test_dashboard_module_catalog.py",
        "server/services/platform-server/tests/unit"
        "/test_dashboard_module_catalog.py",
    }
)
# 模块自己的设计文档
MODULE_DOC = re.compile(r"^docs/MODULE_[\w-]+\.md$")


def _reviewable(name: str) -> bool:
    return name not in LOCKFILES and not any(
        marker in f"/{name}" for marker in GENERATED
    )


def _changed_lines() -> int:
    total = 0
    for line in git("diff", "--numstat", diff_range()).splitlines():
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
        for name in git(
            "diff", "--diff-filter=A", "--name-only", diff_range()
        ).splitlines()
        if name.startswith("server/services/")
        and len(Path(name).parts) > SERVICE_PATH_DEPTH
    }
    fresh = {
        unit
        for unit in added
        if not git(
            "ls-tree",
            "--name-only",
            diff_base(),
            f"server/services/{unit}/src/",
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
        name.startswith(prefix) for name in changed_files() if _reviewable(name)
    )


def _new_module() -> str | None:
    """本次改动首次落下某个大屏模块的目录；否则返回 None。

    判据与 `_new_code_unit` 同源：`web/packages/modules/src/modules/<type>/`
    在 base 上不存在——**不看 PR 标题**，标题可以随手写，仓库历史不能。
    """
    added = {
        Path(name).parts[MODULE_NAME_INDEX]
        for name in git(
            "diff", "--diff-filter=A", "--name-only", diff_range()
        ).splitlines()
        if name.startswith(MODULES_SRC)
        and len(Path(name).parts) > MODULE_PATH_DEPTH
    }
    fresh = {
        module
        for module in added
        if not git(
            "ls-tree", "--name-only", diff_base(), f"{MODULES_SRC}{module}/"
        )
    }
    return next(iter(fresh)) if len(fresh) == 1 else None


def _is_module_landing() -> bool:
    """新模块的首次落地：改动只在这个模块自己的目录、文档与注册处里。

    一个模块的完整落地 = 清单 + 渲染组件 + 取值逻辑 + 测试 + 设计文档 + 重新
    生成的服务端目录，加起来必然过千行，而少任何一样都不满足「一个模块 =
    一个目录 + 一行注册」那条判据（DASHBOARD_DESIGN §5.1）。硬拆只能拆成
    「没有测试的一半」与「一堆没有实现的测试」，那比一个大 PR 更难评审。

    ⚠ 边界与 `_is_landing_commit` 同样机械：只认 base 上**不存在**的模块目录
    （故一个模块只能用一次——第二个 PR 里它已经存在），且**只要有一个文件
    落在允许集合外就整体不豁免**（故触及既有代码的改动一条都带不进来）。
    """
    module = _new_module()
    if module is None:
        return False
    own = (f"{MODULES_SRC}{module}/", f"{MODULES_TESTS}{module}/")
    return all(
        name.startswith(own)
        or name in MODULE_REGISTRY
        or MODULE_DOC.match(name) is not None
        for name in changed_files()
        if _reviewable(name)
    )


def check_pr_size() -> list[Violation]:
    """改动 ≤400 行、≤20 个文件。超了就拆成多个 PR。

    三类例外：机械化改动（标题标记）、新代码单元的首次落地提交
    （[ADR-0006](../../docs/adr/0006-opcua服务端独立成代码单元.md)），
    以及新大屏模块的首次落地（`_is_module_landing`）——后两者都不看标题，
    只看「是不是全部落在一个 base 上尚不存在的目录（及其注册处）里」。
    """
    if _is_mechanical() or _is_landing_commit() or _is_module_landing():
        return []
    files = [name for name in changed_files() if _reviewable(name)]
    lines = _changed_lines()
    found: list[Violation] = []
    if lines > MAX_CHANGED_LINES:
        found.append(
            Violation(
                f"PR 改动不许超过 {MAX_CHANGED_LINES} 行",
                diff_range(),
                f"{lines} 行（不含锁文件与生成物）",
            )
        )
    if len(files) > MAX_CHANGED_FILES:
        found.append(
            Violation(
                f"PR 不许超过 {MAX_CHANGED_FILES} 个文件",
                diff_range(),
                f"{len(files)} 个",
            )
        )
    return found


def check_pr_touches_one_service() -> list[Violation]:
    """跨服务改动拆成「先加新的、后切换、再删旧的」多个 PR。"""
    services = {
        Path(name).parts[2]
        for name in changed_files()
        if name.startswith("server/services/")
        and len(Path(name).parts) > SERVICE_PATH_DEPTH
    }
    if len(services) <= MAX_SERVICES:
        return []
    return [
        Violation(
            f"一个 PR 只许碰 {MAX_SERVICES} 个服务",
            diff_range(),
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
    files = set(changed_files())
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
            diff_range(),
            f"{sorted(touched)} 与另外 {len(others)} 个文件混在一起",
        )
    ]


def check_commit_messages() -> list[Violation]:
    """标题写做了什么，格式 `<类型>(<范围>): <一句话>`。"""
    span = f"{diff_base()}..{diff_head()}"
    subjects = git("log", "--format=%s", span).splitlines()
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
    name = os.environ.get("PR_HEAD_BRANCH") or git(
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
