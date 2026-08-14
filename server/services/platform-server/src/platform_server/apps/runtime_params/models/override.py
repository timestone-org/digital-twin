"""运行参数覆盖表：一项一行，且**只存被改过的项**。

删掉一行即恢复默认，此后该项重新跟随环境变量。稀疏存储换来的是「新增配置项
零迁移」——参数目录是代码里的一张表，加一项不该动数据库。

⚠ 环境变量是永久默认值而不是一次性播种：这张表里没有的项，每次读都回落到
当时的环境变量，而不是启动时抄一份存进来。
"""

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from platform_server.apps.runtime_params.models.base import Base


class RuntimeParamOverride(Base):
    """某个运行参数的覆盖值。`(section, key)` 复合主键。"""

    __tablename__ = "runtime_param_overrides"

    section: Mapped[str] = mapped_column(Text, primary_key=True)
    # 配置模型上的字段名，不带服务前缀
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value_json: Mapped[Any] = mapped_column(JSONB, nullable=False)
    # 本项此前的有效值，供复盘定位「从多少改到多少」；首次覆盖时是当时的默认值
    previous_value_json: Mapped[Any] = mapped_column(JSONB, nullable=True)
    updated_by: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=""
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        CheckConstraint("length(section) > 0", name="section_nonempty"),
        CheckConstraint("length(key) > 0", name="key_nonempty"),
    )
