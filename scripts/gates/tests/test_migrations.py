"""迁移闸：回填判定认得带 schema 的表名，存量表上加约束必须分两步。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_migrations as gate

import _report

HEADER = (
    "from alembic import op\n"
    "import sqlalchemy as sa\n\n\n"
    "def upgrade() -> None:\n"
    "    op.execute(\"SET lock_timeout = '3s'\")\n"
)
DOWNGRADE = "\n\ndef downgrade() -> None:\n    raise NotImplementedError\n"
BACKFILL_IN_DOWNGRADE = (
    "\n\ndef downgrade() -> None:\n"
    '    op.execute("UPDATE platform.t SET a = 1")\n'
)


class _GateCase(unittest.TestCase):
    """在临时仓库根里写一份迁移再跑某一条检查。"""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        replacement = patch.object(_report, "ROOT", self.root)
        replacement.start()
        self.addCleanup(replacement.stop)

    def _revision(self, body: str, *, name: str = "r1.py") -> Path:
        path = self.root / "versions" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(HEADER + body + DOWNGRADE, encoding="utf-8")
        return path

    def _run(self, check: object, *paths: Path) -> list[_report.Violation]:
        with patch.object(gate, "_all_versions", return_value=list(paths)):
            assert callable(check)
            found = check()
            assert isinstance(found, list)
            return found


class BackfillPatternTests(unittest.TestCase):
    """回填正则本身：带 schema、带引号的表名都要认得。"""

    def test_schema_qualified_writes_are_backfills(self) -> None:
        for statement in (
            "UPDATE platform.t SET a = 1",
            "update t set a = 1",
            "INSERT INTO platform.t (a) SELECT 1",
            'insert into "platform"."t" select 1',
            "DELETE FROM platform.t WHERE a = 1",
        ):
            with self.subTest(statement=statement):
                assert gate.BACKFILL.search(statement) is not None

    def test_structure_statements_are_not_backfills(self) -> None:
        for statement in (
            "SET lock_timeout = '3s'",
            "ALTER TABLE x VALIDATE CONSTRAINT y",
            "LOCK TABLE x IN SHARE UPDATE EXCLUSIVE MODE",
            "ALTER TABLE x ADD CONSTRAINT fk FOREIGN KEY (a) "
            "REFERENCES y (id) ON UPDATE CASCADE ON DELETE SET NULL",
            "INSERT INTO platform.t (a) VALUES (1)",
        ):
            with self.subTest(statement=statement):
                assert gate.BACKFILL.search(statement) is None


class BackfillCheckTests(_GateCase):
    """回填检查：f-string 也要看，豁免只认登记过的那一处。"""

    def test_a_schema_qualified_update_is_flagged(self) -> None:
        path = self._revision('    op.execute("UPDATE platform.t SET a = 1")\n')
        found = self._run(gate.check_no_backfill_in_migration, path)
        assert [item.rule for item in found] == ["迁移里禁止回填数据"]

    def test_an_f_string_update_is_flagged(self) -> None:
        path = self._revision(
            '    table = "platform.t"\n'
            '    op.execute(f"UPDATE {table} SET a = 1")\n'
        )
        found = self._run(gate.check_no_backfill_in_migration, path)
        assert len(found) == 1

    def test_the_registered_downgrade_exception_is_allowed(self) -> None:
        name, scope = next(iter(gate.BACKFILL_ALLOWED))
        assert scope == "downgrade"
        path = self.root / "versions" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(HEADER + BACKFILL_IN_DOWNGRADE, encoding="utf-8")
        assert self._run(gate.check_no_backfill_in_migration, path) == []

    def test_the_same_statement_in_upgrade_is_still_flagged(self) -> None:
        name, _scope = next(iter(gate.BACKFILL_ALLOWED))
        path = self._revision(
            '    op.execute("UPDATE platform.t SET a = 1")\n', name=name
        )
        assert len(self._run(gate.check_no_backfill_in_migration, path)) == 1


class ConstraintCheckTests(_GateCase):
    """存量表加约束：NOT VALID 再 VALIDATE，唯一约束走 USING INDEX。"""

    def _check(self, body: str) -> list[_report.Violation]:
        path = self._revision(body)
        return self._run(gate.check_constraint_on_existing_table, path)

    def test_a_one_step_check_on_an_existing_table_is_flagged(self) -> None:
        found = self._check(
            '    op.create_check_constraint("ck_t_a", "t", "a > 0")\n'
        )
        assert len(found) == 1

    def test_a_check_on_a_table_created_alongside_is_fine(self) -> None:
        found = self._check(
            '    op.create_table("t", sa.Column("a", sa.Integer()))\n'
            '    op.create_check_constraint("ck_t_a", "t", "a > 0")\n'
        )
        assert found == []

    def test_a_not_valid_check_keyword_is_fine(self) -> None:
        found = self._check(
            "    op.create_check_constraint(\n"
            '        "ck_t_a", "t", "a > 0", postgresql_not_valid=True\n'
            "    )\n"
        )
        assert found == []

    def test_a_one_step_unique_or_foreign_key_is_flagged(self) -> None:
        found = self._check(
            '    op.create_unique_constraint("uq_t_a", "t", ["a"])\n'
            '    op.create_foreign_key("fk_t_b", "t", "b", ["b"], ["id"])\n'
        )
        assert len(found) == 2

    def test_raw_sql_without_not_valid_is_flagged(self) -> None:
        found = self._check(
            '    op.execute("ALTER TABLE platform.t '
            'ADD CONSTRAINT ck CHECK (a > 0)")\n'
        )
        assert len(found) == 1

    def test_raw_sql_with_not_valid_is_fine(self) -> None:
        found = self._check(
            '    op.execute("ALTER TABLE platform.t '
            'ADD CONSTRAINT ck CHECK (a > 0) NOT VALID")\n'
            '    op.execute("ALTER TABLE platform.t VALIDATE CONSTRAINT ck")\n'
            '    op.execute("ALTER TABLE platform.t '
            'ADD CONSTRAINT uq UNIQUE USING INDEX uq")\n'
        )
        assert found == []

    def test_a_raw_unique_without_using_index_is_flagged(self) -> None:
        found = self._check(
            '    op.execute("ALTER TABLE platform.t '
            'ADD CONSTRAINT uq UNIQUE (a)")\n'
        )
        assert len(found) == 1

    def test_a_helper_called_from_upgrade_is_inspected(self) -> None:
        path = self.root / "versions" / "r2.py"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            HEADER
            + "    _swap()\n\n\n"
            + "def _swap() -> None:\n"
            + '    op.create_check_constraint("ck_t_a", "t", "a > 0")\n'
            + DOWNGRADE,
            encoding="utf-8",
        )
        found = self._run(gate.check_constraint_on_existing_table, path)
        assert len(found) == 1

    def test_downgrade_is_not_inspected(self) -> None:
        path = self.root / "versions" / "r3.py"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            HEADER
            + "\n\ndef downgrade() -> None:\n"
            + '    op.create_check_constraint("ck_t_a", "t", "a > 0")\n',
            encoding="utf-8",
        )
        assert self._run(gate.check_constraint_on_existing_table, path) == []

    def test_registered_applied_revisions_are_allowed(self) -> None:
        name = next(iter(gate.CONSTRAINT_ALLOWED))
        path = self._revision(
            '    op.create_check_constraint("ck_t_a", "t", "a > 0")\n',
            name=name,
        )
        assert self._run(gate.check_constraint_on_existing_table, path) == []


if __name__ == "__main__":
    unittest.main()
