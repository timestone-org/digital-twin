"""放开用途码的 CHECK，多认一档「知识库重排」（ADR-0042）。

纯扩展步：只放宽一条 CHECK，一列都不加、一行都不改。旧代码不认识这一档用途、
也不会写进来，故「新结构 + 旧代码」可用。没有回填。

⚠ 放宽一条 CHECK 只能「先撤旧的、再加新的」——两条同时挂着的话，窄的那一条
照样把新用途拒掉。中间那一瞬没有约束，而这一步只放宽不收窄，故没有会被漏过去
的坏数据。

⚠ 模型种类那一格**没有 CHECK 可放**：模型清单存在 `models_json` 里，种类由
入参 schema 与 `rules.py` 把关，库上只有一条「必须是数组」。

Revision ID: b6f4a20d75e1
Revises: a7e1c93b6d40
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b6f4a20d75e1"
down_revision: str | None = "b8f2d41a07c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_ASSIGNMENTS = "llm_assignments"
_CONSTRAINT = "ck_llm_assignments_purpose_known"

# ⚠ 用途码是**写死的字面量**，不许改成 import `apps/llm_providers/enums.py`：
# 迁移是冻结件，而那是个活常量——同一个 revision 在旧库与新建库上必须建出
# 同一个集合。两侧不许漂由 `llm-shapes.contract.spec.ts` 盯着
PURPOSES = (
    "'assistant.chat', 'assistant.vision', 'assistant.summary', "
    "'assistant.embedding', 'knowledge.chat', 'knowledge.embedding', "
    "'knowledge.rerank'"
)
# 这一步之前那一版认的集合，撤回时用
PURPOSES_BEFORE = (
    "'assistant.chat', 'assistant.vision', 'assistant.summary', "
    "'assistant.embedding', 'knowledge.chat', 'knowledge.embedding'"
)


def _swap(purposes: str) -> None:
    """把用途码那条 CHECK 换成给定的集合。

    ⚠ 先 `NOT VALID` 再 `VALIDATE`：前者只拿一瞬的重锁，后者是
    SHARE UPDATE EXCLUSIVE，不挡读写。

    Args: purposes。
    """
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_constraint(_CONSTRAINT, _ASSIGNMENTS, type_="check", schema=_SCHEMA)
    op.execute(
        f"ALTER TABLE {_SCHEMA}.{_ASSIGNMENTS} "
        f"ADD CONSTRAINT {_CONSTRAINT} CHECK (purpose IN ({purposes})) "
        "NOT VALID"
    )
    op.execute(
        f"ALTER TABLE {_SCHEMA}.{_ASSIGNMENTS} "
        f"VALIDATE CONSTRAINT {_CONSTRAINT}"
    )


def upgrade() -> None:
    _swap(PURPOSES)


def downgrade() -> None:
    """⚠ 收窄之前先确认没有重排那一档的分配行：有的话 `VALIDATE` 当场失败。
    这一步不替调用方删数据——删的是配置不是缓存。"""
    _swap(PURPOSES_BEFORE)
