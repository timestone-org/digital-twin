"""公式库表：可被任意台账的公式列以 `@标识(实参)` 调用的具名计算单元。

⚠ **不建外键指向它，也不给它建版本表**（docs/DATASET_DESIGN.md §5.11）：
台账列与库公式之间只有一条**文本**联系（列公式里的 `@标识(`），故「谁在用它」
只能重新解析，不能 JOIN；而改一条库公式即刻改掉全部引用方的口径，历史行等
下一次重算才跟上。
"""

from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dataset.models.base import Base
from platform_server.apps.dataset.models.column import (
    KEY_PATTERN,
    MAX_FORMULA_LENGTH,
)

# 公式标识的字符禁令：与列 key 同一条规则，**直接复用不再抄一遍**。
# ⚠ 两者必须同源：`@` 与花括号在任一侧漏禁，`{a@b}` 这类写法就会在替换之后
# 剩下半个记号，报的是一句用户根本没写过的东西（models/column.py 的告诫）
CODE_PATTERN = KEY_PATTERN
# 一条库公式最多几个形参。⚠ 有上限不是省空间：`params_json` 是个无界数组入参
MAX_FX_PARAMS = 8
# 分类只用于界面分组与搜索
MAX_CATEGORY_LENGTH = 32
# 出厂分类，也是自建公式的默认分类
DEFAULT_CATEGORY = "custom"

# ⚠ 由 `CODE_PATTERN` 推导，不许再抄一遍。迁移里那份是手写的冻结字面量
# （冻结件不许 import 活常量），两侧不许漂由
# tests/contract/test_dataset_ddl_literals.py 盯着。
# SQL 字面量里的单引号要写成两个，故转义在这里做一次。
_CODE_CHECK = f"""code ~ '{CODE_PATTERN.replace("'", "''")}'"""


class DatasetFormula(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条库公式。`code` 全局唯一，且建后不可改——它就是调用点的字面量。"""

    __tablename__ = "dataset_formulas"

    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    # 公式体，形参写作 `{形参名}`
    expression: Mapped[str] = mapped_column(Text, nullable=False)
    # 有序的形参表 `[{name, kind, label, hint, default}]`
    params_json: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 出厂预设：删不得（只能停用），且改坏了能恢复出厂口径
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # ⚠ 停用与删除一样是破坏性的：引用它的列在**解析期**就报错，而保存任一列
    # 都会试编译整张表，于是那张表的录入、导入、修正与重算一起 400（§5.11）
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (
        UniqueConstraint("code"),
        CheckConstraint("length(code) BETWEEN 1 AND 64", name="code_sized"),
        CheckConstraint(_CODE_CHECK, name="code_has_no_formula_token"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint(
            f"length(category) BETWEEN 1 AND {MAX_CATEGORY_LENGTH}",
            name="category_sized",
        ),
        CheckConstraint(
            f"length(expression) BETWEEN 1 AND {MAX_FORMULA_LENGTH}",
            name="expression_sized",
        ),
        # 形参表必须是数组：存成对象或标量时，读侧只会静默少一批形参
        CheckConstraint(
            "jsonb_typeof(params_json) = 'array'", name="params_are_an_array"
        ),
    )
