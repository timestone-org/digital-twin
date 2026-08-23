"""建公式库表（docs/DATASET_DESIGN.md §5.11）。

一张普通表，跨台账的全局资源，几十行量级。索引一个都不加：`load_library` 本来
就是整表无 WHERE 扫描，几十行上的索引不会被选中。内置预设由
`scripts/seed.py` 写入，不在这里灌——迁移只负责结构。

Revision ID: a3f27b6c05d1
Revises: f2a91c7d3b48
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a3f27b6c05d1"
down_revision: str | None = "f2a91c7d3b48"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "dataset_formulas"

# ⚠ 下面几个是**写死的字面量**，不许改成 import `apps/dataset/models`：迁移是
# 冻结件，而那是活常量——将来放宽一处上限，同一个 revision 会在旧库建出旧约束、
# 在新建库建出新约束，且没有任何东西会报错。两侧不许漂由
# tests/contract/test_dataset_ddl_literals.py 盯着。
# 与 models/formula.py 的 CODE_PATTERN 同一条规则；SQL 字面量里的单引号
# 要写成两个
CODE_CHECK = "code ~ '^[^\\s@''\"(),.:{}\\[\\]]+$'"
# 与 models/column.py 的 MAX_FORMULA_LENGTH 同值
MAX_FORMULA_LENGTH = 2_000
# 与 models/formula.py 的 MAX_CATEGORY_LENGTH 同值
MAX_CATEGORY_LENGTH = 32
# 与 models/formula.py 的 DEFAULT_CATEGORY 同值
DEFAULT_CATEGORY = "custom"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        _TABLE,
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "category",
            sa.Text(),
            server_default=sa.text(f"'{DEFAULT_CATEGORY}'"),
            nullable=False,
        ),
        sa.Column("expression", sa.Text(), nullable=False),
        sa.Column(
            "params_json",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_builtin",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_dataset_formulas"),
        # `code` 就是调用点上的那个字面量 `@code(…)`，撞了就是两条公式共用身份
        sa.UniqueConstraint("code", name="uq_dataset_formulas_code"),
        *_checks(),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ 删掉这张表就删掉了全部库公式，而引用它们的台账列只留着一段 `@标识(…)`
    # 文本——那些列会在下一次保存或重算时报「公式库当前是空的」
    op.drop_table(_TABLE, schema=_SCHEMA)


def _checks() -> tuple[sa.CheckConstraint, ...]:
    """全部 CHECK。装成一组只为让建表那段不超过函数行数上限。"""
    return (
        sa.CheckConstraint(
            "length(code) BETWEEN 1 AND 64",
            name="ck_dataset_formulas_code_sized",
        ),
        # code 里禁掉公式语法的记号，否则 `@标识(` 切不回这条公式
        sa.CheckConstraint(
            CODE_CHECK, name="ck_dataset_formulas_code_has_no_formula_token"
        ),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_dataset_formulas_name_nonempty"
        ),
        sa.CheckConstraint(
            f"length(category) BETWEEN 1 AND {MAX_CATEGORY_LENGTH}",
            name="ck_dataset_formulas_category_sized",
        ),
        sa.CheckConstraint(
            f"length(expression) BETWEEN 1 AND {MAX_FORMULA_LENGTH}",
            name="ck_dataset_formulas_expression_sized",
        ),
        # 形参表必须是数组：存成对象或标量时，读侧只会静默少一批形参
        sa.CheckConstraint(
            "jsonb_typeof(params_json) = 'array'",
            name="ck_dataset_formulas_params_are_an_array",
        ),
    )
