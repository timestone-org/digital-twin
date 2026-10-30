"""建模结构迁移与可续跑并发索引的阶段边界。"""

import ast
import importlib.util
from contextlib import nullcontext
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

SERVICE = Path(__file__).resolve().parents[2]
VERSIONS = SERVICE / "migrations" / "versions"
STRUCTURES = ("modeling_management_20261030", "modeling_commands_20261030")
INDEXES = (
    "modeling_management_idx_20261030",
    "modeling_commands_idx_20261030",
)


def migration_path(revision: str) -> Path:
    matches = list(VERSIONS.glob(f"*-{revision}*.py"))
    assert len(matches) == 1, f"revision {revision} 必须恰有一个源文件"
    return matches[0]


def load_migration(revision: str):
    spec = importlib.util.spec_from_file_location(
        revision, migration_path(revision)
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_index_failure_keeps_a_completed_structure_revision_to_resume_from():
    scripts = ScriptDirectory.from_config(Config(str(SERVICE / "alembic.ini")))
    chain = (
        ("modeling_management_20261030", "f02b841ac356"),
        ("modeling_management_idx_20261030", "modeling_management_20261030"),
        ("modeling_commands_20261030", "modeling_management_idx_20261030"),
        ("modeling_commands_idx_20261030", "modeling_commands_20261030"),
    )
    for revision, predecessor in chain:
        script = scripts.get_revision(revision)
        assert script is not None
        assert script.down_revision == predecessor
    assert scripts.get_current_head() == "modeling_commands_idx_20261030"


@pytest.mark.parametrize("revision", STRUCTURES)
def test_structure_revision_has_no_nontransactional_index_phase(revision):
    tree = ast.parse(migration_path(revision).read_text(encoding="utf-8"))
    operations = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert not operations & {"autocommit_block", "create_index", "drop_index"}


@pytest.mark.parametrize("revision", INDEXES)
def test_index_revision_only_changes_indexes_and_replaces_invalid_ones(
    revision,
):
    tree = ast.parse(migration_path(revision).read_text(encoding="utf-8"))
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    ]
    forbidden = {"create_table", "add_column", "drop_column", "drop_table"}
    assert not {node.func.attr for node in calls} & forbidden
    index_calls = [
        node
        for node in calls
        if node.func.attr in {"create_index", "drop_index"}
    ]
    assert index_calls
    for node in index_calls:
        keywords = {item.arg: item.value for item in node.keywords}
        assert ast.literal_eval(keywords["postgresql_concurrently"]) is True
        if node.func.attr == "drop_index":
            assert ast.literal_eval(keywords["if_exists"]) is True


class InterruptedIndexOperations:
    def __init__(self, fail_at: int):
        self.fail_at = fail_at
        self.created = 0
        self.indexes: dict[str, bool] = {}

    def execute(self, _statement):
        return None

    def get_context(self):
        return self

    def autocommit_block(self):
        return nullcontext()

    def drop_index(self, name, **_keywords):
        self.indexes.pop(name, None)

    def create_index(self, name, _table, _columns, **_keywords):
        self.created += 1
        self.indexes[name] = False
        if self.created == self.fail_at:
            raise RuntimeError("index build interrupted")
        self.indexes[name] = True


@pytest.mark.parametrize(
    ("revision", "fail_at", "expected_count"),
    [(INDEXES[0], 2, 10), (INDEXES[1], 1, 1)],
    ids=["management-indexes", "command-index"],
)
def test_interrupted_index_phase_can_be_invoked_again(
    monkeypatch, revision, fail_at, expected_count
):
    migration = load_migration(revision)
    operations = InterruptedIndexOperations(fail_at)
    monkeypatch.setattr(migration, "op", operations)
    with pytest.raises(RuntimeError, match="index build interrupted"):
        migration.upgrade()
    assert False in operations.indexes.values()
    migration.upgrade()
    assert len(operations.indexes) == expected_count
    assert all(operations.indexes.values())
