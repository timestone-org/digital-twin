#!/usr/bin/env python3
"""测试运行结果闸：testing-standard-python.md §4.3、§6.2、§6.4。

⚠ `--cov=` 写成路径形式时，coverage 会**静默**跳过并报 module-not-imported，
数字虚高而无人察觉——闸门于是形同虚设。
⚠ CI 里 skip 掉的用例等于没跑：本机缺 Postgres 是环境问题，CI 里不存在这回事。

用法：`check_pytest_run.py <junit.xml> <pytest 输出日志>`
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from xml.etree import ElementTree

from _report import Violation, main, read

MODULE_NOT_IMPORTED = re.compile(r"module-not-imported|was never imported")
# 真实外网请求会让测试从「稳定失败」退化成「偶发超时」
NETWORK_LEAK = re.compile(r"ConnectTimeout|NameResolutionError|Max retries")
# junit 报告 + pytest 日志，两个必填参数
REQUIRED_ARGS = 3


def _suites(path: Path) -> list[ElementTree.Element]:
    root = ElementTree.parse(path).getroot()
    return list(root.iter("testsuite"))


def _count(path: Path, attribute: str) -> int:
    return sum(int(suite.get(attribute, "0")) for suite in _suites(path))


def check_no_skipped_tests() -> list[Violation]:
    """CI 里不接受 skip：环境能力由服务容器保证，缺了就该红。"""
    report = Path(sys.argv[1])
    skipped = _count(report, "skipped")
    if not skipped:
        return []
    names = [
        f"{case.get('classname')}::{case.get('name')}"
        for suite in _suites(report)
        for case in suite.iter("testcase")
        if case.find("skipped") is not None
    ]
    return [
        Violation(
            "CI 里不许有被跳过的用例",
            str(report),
            f"{skipped} 条：{'、'.join(names[:5])}",
        )
    ]


def check_no_errors() -> list[Violation]:
    """collection error 与 fixture 报错不会体现在失败数里，要单独看。"""
    report = Path(sys.argv[1])
    errors = _count(report, "errors")
    if not errors:
        return []
    return [Violation("测试收集或夹具出错", str(report), f"{errors} 处")]


def check_coverage_measured_every_module() -> list[Violation]:
    """`--cov=` 必须用点号模块名，否则覆盖率数字虚高。"""
    log = Path(sys.argv[2])
    if not log.is_file():
        return []
    match = MODULE_NOT_IMPORTED.search(read(log))
    if match is None:
        return []
    return [
        Violation(
            "覆盖率统计漏了模块",
            str(log),
            f"{match.group(0)}；--cov= 要写点号模块名，不是路径",
        )
    ]


def check_no_real_network() -> list[Violation]:
    """测试进程不许发起真实外网请求。"""
    log = Path(sys.argv[2])
    if not log.is_file():
        return []
    match = NETWORK_LEAK.search(read(log))
    if match is None:
        return []
    return [
        Violation(
            "测试里出现了真实外网请求",
            str(log),
            f"{match.group(0)}；外部依赖用假件或本地容器",
        )
    ]


CHECKS = (
    check_no_skipped_tests,
    check_no_errors,
    check_coverage_measured_every_module,
    check_no_real_network,
)


if __name__ == "__main__":
    if len(sys.argv) < REQUIRED_ARGS:
        sys.stderr.write("用法：check_pytest_run.py <junit.xml> <日志>\n")
        raise SystemExit(2)
    raise SystemExit(main("测试运行结果检查", CHECKS))
