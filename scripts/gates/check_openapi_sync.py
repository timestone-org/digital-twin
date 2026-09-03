#!/usr/bin/env python3
"""openapi.json 与代码一致：api-contract.md §7。

`openapi.json` 是前后端之间唯一的类型真源，重新生成必须逐字节一致。CI 在
「4·契约与迁移可逆性」里逐个服务判这一条，而那一段排在四段之后——本地没有
同一道闸，于是「改了 docstring 忘了重导」只能等合进 main 才发现。本轮踩过
两次（#179→#184、#185→#189），两次都让 main 红着。

⚠ 命令与工作目录**从 `ci.yml` 里现读**，不在这里另抄一份：抄一份就会漂，
而漂了之后本地绿、CI 红，正是这道闸要消灭的情形。

⚠ 按行扫而不是 `yaml.safe_load`：闸门脚本只用标准库，而 pyyaml 在这个 venv
里只是别人的传递依赖——哪天那个依赖换了实现，这道闸会以 ImportError 消失。
扫不出步骤时抛 GateError，所以格式真变了会当场红，不会悄悄放行。

⚠ 不给导出脚本喂环境变量：那几份 `export_openapi.py` 自己造占位配置，不连
任何依赖。CI 那几步的 `env:` 是给同一个作业里别的步骤用的。
"""

from __future__ import annotations

import os
import re
import shlex
import subprocess
from pathlib import Path

from _report import ROOT, GateError, Violation, main, read

WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
# CI 里那几步的名字都带这一句；按它认，而不是按服务名另列一张表
MARK = "openapi.json 与代码一致"
RULE = "openapi.json 必须与代码一致"
# 导出脚本判出不一致时打的那一句。⚠ 靠它把「不一致」与「压根没跑起来」分开：
# 只看退出码的话，uv 装不上也会被报成「接口漂了」，而那会让人去查错的地方
DRIFTED = "openapi.json 与代码不一致"

_NAME = re.compile(rf"^\s*- name:.*{re.escape(MARK)}\s*$")
_STEP = re.compile(r"^\s*- (?:name|uses):")
_FIELD = re.compile(r"^\s*(working-directory|run):\s*(.+?)\s*$")


def _step_at(lines: list[str], start: int) -> tuple[Path, list[str]]:
    """从某一步的 `- name:` 往下读，取它的工作目录与命令。

    Args: lines, start（那一行的下标）。
    """
    where = ""
    command = ""
    for line in lines[start + 1 :]:
        if _STEP.match(line):
            break
        found = _FIELD.match(line)
        if found is None:
            continue
        if found.group(1) == "run":
            command = found.group(2)
        else:
            where = found.group(2)
    if not where or not command:
        raise GateError(f"{WORKFLOW.name} 第 {start + 1} 行那一步缺目录或命令")
    return ROOT / where, shlex.split(command)


def _steps() -> list[tuple[Path, list[str]]]:
    """`ci.yml` 里判 openapi 的那几步。

    ⚠ 一步都没挑出来要抛而不是回空：闸门拿到空集合会无条件通过，而「步骤改了
    名之后这道闸悄悄什么都不判了」比它从来没存在过更糟。
    """
    lines = read(WORKFLOW).splitlines()
    made = [
        _step_at(lines, at)
        for at, line in enumerate(lines)
        if _NAME.match(line)
    ]
    if not made:
        raise GateError(f"{WORKFLOW.name} 里找不到判 openapi 的步骤")
    return made


def _checked() -> list[Violation]:
    """逐个服务重新导出一遍，与仓里那份比。"""
    made: list[Violation] = []
    for where, command in _steps():
        done = subprocess.run(
            command,
            cwd=where,
            env=dict(os.environ),
            capture_output=True,
            text=True,
            check=False,
        )
        if done.returncode == 0:
            continue
        if DRIFTED not in done.stderr:
            raise GateError(
                f"{where.name} 的导出脚本没跑起来："
                f"{done.stderr.strip()[-300:]}"
            )
        made.append(
            Violation(
                rule=RULE,
                where=str(where.relative_to(ROOT)),
                detail="重新跑一遍这个服务的 scripts/export_openapi.py 再提交",
            )
        )
    return made


if __name__ == "__main__":
    raise SystemExit(main("openapi 一致性", [_checked]))
