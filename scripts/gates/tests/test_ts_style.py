"""组合式函数的行数上限也要管住「薄壳 use*.ts + 厚 *State.ts」的拆法。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_ts_style as gate

import _report

HIERARCHY_PAGE_STATE = (
    "web/app/src/pages/Tools/Hierarchy/scripts/hierarchyPageState.ts"
)
VUE_IMPORT = "import { ref, watch } from 'vue'\n"


class ComposableStateSizeTests(unittest.TestCase):
    """`*State.ts` 里装着组合式函数的状态与逻辑，与 `use*.ts` 同一上限。"""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        replacement = patch.object(_report, "ROOT", self.root)
        replacement.start()
        self.addCleanup(replacement.stop)

    def _write(self, name: str, source: str) -> Path:
        path = self.root / "web" / "app" / "src" / "scripts" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
        return path

    def _check(self, *paths: Path) -> list[_report.Violation]:
        with patch.object(gate, "web_sources", return_value=list(paths)):
            return gate.check_component_size()

    def test_oversized_state_file_is_flagged(self) -> None:
        path = self._write("pageState.ts", VUE_IMPORT + "x\n" * 220)
        found = self._check(path)
        assert [item.where for item in found] == [
            "web/app/src/scripts/pageState.ts"
        ]

    def test_state_file_without_vue_is_plain_logic(self) -> None:
        path = self._write("edgeState.ts", "x\n" * 220)
        assert self._check(path) == []

    def test_small_state_file_passes(self) -> None:
        path = self._write("pageState.ts", VUE_IMPORT + "x\n" * 10)
        assert self._check(path) == []


class RepositoryStateDebtTests(unittest.TestCase):
    """真仓上的存量超限文件只能靠登记过的欠账表放行。"""

    def test_hierarchy_page_state_is_caught_without_its_debt_entry(
        self,
    ) -> None:
        with patch.object(gate, "OVERSIZED_STATE_DEBT", frozenset[str]()):
            found = gate.check_component_size()
        assert HIERARCHY_PAGE_STATE in [item.where for item in found]

    def test_debt_entries_still_exceed_the_limit(self) -> None:
        assert gate.check_state_debt_is_current() == []

    def test_stale_debt_entry_is_flagged(self) -> None:
        stale = "web/app/src/pages/Gone/scripts/goneState.ts"
        with patch.object(gate, "OVERSIZED_STATE_DEBT", frozenset({stale})):
            found = gate.check_state_debt_is_current()
        assert [item.where for item in found] == [stale]


if __name__ == "__main__":
    unittest.main()
