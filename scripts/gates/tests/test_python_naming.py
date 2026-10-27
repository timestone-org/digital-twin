"""标准库固定参数名的例外只适用于对应执行器替身。"""

import inspect
import tempfile
import unittest
from concurrent.futures import Executor
from pathlib import Path
from unittest.mock import patch

import check_python_naming as gate

import _report

EXECUTOR_TEST = (
    "server/services/platform-server/tests/unit/test_modeling_run_pool.py"
)
SHUTDOWN = (
    "def shutdown(self, wait: bool = True, *, "
    "cancel_futures: bool = False) -> None:\n    pass\n"
)


class PythonNamingTests(unittest.TestCase):
    """固定参数、文件边界与普通布尔名的判定。"""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        replacement = patch.object(_report, "ROOT", self.root)
        replacement.start()
        self.addCleanup(replacement.stop)

    def _check(self, relative: str, source: str) -> list[_report.Violation]:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
        with patch.object(gate, "_all_python", return_value=[path]):
            return gate.check_boolean_names()

    def test_executor_shutdown_keeps_its_standard_keyword_names(self) -> None:
        assert list(inspect.signature(Executor.shutdown).parameters) == [
            "self",
            "wait",
            "cancel_futures",
        ]

    def test_executor_keywords_are_allowed_in_its_test_double(self) -> None:
        assert self._check(EXECUTOR_TEST, SHUTDOWN) == []

    def test_executor_keywords_are_rejected_in_other_files(self) -> None:
        found = self._check("apps/modeling/runtime.py", SHUTDOWN)
        assert [item.detail for item in found] == ["wait", "cancel_futures"]

    def test_other_booleans_in_the_same_file_still_require_prefixes(
        self,
    ) -> None:
        found = self._check(EXECUTOR_TEST, "closed: bool = False\n")
        assert [item.detail for item in found] == ["closed"]
