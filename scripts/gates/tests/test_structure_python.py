"""lib 零项目名词：每一个上过线的业务模块名都要被拦下。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_structure_python as gate

import _report


class LibProjectNounTests(unittest.TestCase):
    """lib 源码里出现业务模块名即失败，连文档串也算。"""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        replacement = patch.object(_report, "ROOT", self.root)
        replacement.start()
        self.addCleanup(replacement.stop)

    def _check(self, line: str) -> list[_report.Violation]:
        path = self.root / "lib" / "vectors.py"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f'"""{line}"""\n', encoding="utf-8")
        with patch.object(gate, "_python", return_value=[path]):
            return gate.check_lib_has_no_project_nouns()

    def test_assistant_and_knowledge_nouns_are_flagged(self) -> None:
        for line in (
            "助手的长期记忆",
            "知识库的回退档索引",
            "used by the Assistant",
            "knowledge chunks",
        ):
            with self.subTest(line=line):
                assert len(self._check(line)) == 1

    def test_neutral_line_passes(self) -> None:
        assert self._check("把向量压成字节存进 bytea、取回来算余弦") == []

    def test_acknowledge_is_not_a_project_noun(self) -> None:
        assert self._check("entries are acknowledged with XACK") == []


if __name__ == "__main__":
    unittest.main()
