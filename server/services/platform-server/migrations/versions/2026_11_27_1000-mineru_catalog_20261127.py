"""扩展模型目录的 MinerU 接入形态与知识库文档解析用途。"""

from collections.abc import Sequence

from alembic import op

revision: str = "mineru_catalog_20261127"
down_revision: str | None = "hvac_unassessed_20261121"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = "'openai_compat', 'codex_oauth', 'mineru'"
PURPOSES = (
    "'assistant.chat', 'assistant.vision', 'assistant.summary', "
    "'assistant.embedding', 'knowledge.chat', 'knowledge.embedding', "
    "'knowledge.rerank', 'knowledge.parse'"
)


def _replace(table: str, column: str, values: str) -> None:
    """验证新允许值后替换旧约束。Args: table, column, values。"""
    name = f"ck_{table}_{column}_known"
    target = f"platform.{table}"
    op.execute(
        f"ALTER TABLE {target} ADD CONSTRAINT {name}_next "
        f"CHECK ({column} IN ({values})) NOT VALID"
    )
    op.execute(f"ALTER TABLE {target} VALIDATE CONSTRAINT {name}_next")
    op.execute(f"ALTER TABLE {target} DROP CONSTRAINT {name}")
    op.execute(f"ALTER TABLE {target} RENAME CONSTRAINT {name}_next TO {name}")


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    _replace("llm_providers", "kind", KINDS)
    _replace("llm_assignments", "purpose", PURPOSES)


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    _replace(
        "llm_assignments",
        "purpose",
        PURPOSES.removesuffix(", 'knowledge.parse'"),
    )
    _replace("llm_providers", "kind", KINDS.removesuffix(", 'mineru'"))
