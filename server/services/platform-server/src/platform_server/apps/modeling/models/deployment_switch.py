"""部署版本切换的持久关系与不可变记录。"""

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import Base, CreatedAtMixin


class ModelingDeploymentSwitch(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "modeling_deployment_switches"

    deployment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "platform.modeling_deployments.id",
            ondelete="SET NULL",
            name="fk_modeling_switches_deployment",
        ),
        nullable=True,
    )
    deployment_code: Mapped[str] = mapped_column(Text)
    from_model_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "platform.modeling_model_versions.id",
            ondelete="RESTRICT",
            name="fk_modeling_switches_from_model",
        ),
        nullable=True,
    )
    from_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "platform.modeling_rule_versions.id",
            ondelete="RESTRICT",
            name="fk_modeling_switches_from_rule",
        ),
        nullable=True,
    )
    to_model_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "platform.modeling_model_versions.id",
            ondelete="RESTRICT",
            name="fk_modeling_switches_to_model",
        ),
        nullable=True,
    )
    to_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "platform.modeling_rule_versions.id",
            ondelete="RESTRICT",
            name="fk_modeling_switches_to_rule",
        ),
        nullable=True,
    )
    rollback_of_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "platform.modeling_deployment_switches.id",
            ondelete="RESTRICT",
            name="fk_modeling_switches_rollback",
        ),
        nullable=True,
    )
    revision: Mapped[int] = mapped_column(Integer)
    is_signature_change_confirmed: Mapped[bool] = mapped_column(Boolean)
    created_by_name: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(
            "(from_model_id IS NULL) <> (from_rule_id IS NULL)",
            name="one_source",
        ),
        CheckConstraint(
            "(to_model_id IS NULL) <> (to_rule_id IS NULL)", name="one_target"
        ),
        CheckConstraint("revision > 1", name="revision_positive"),
    )

    @property
    def from_version_id(self) -> uuid.UUID:
        identity = self.from_model_id or self.from_rule_id
        if identity is None:
            raise ValueError("切换记录缺少来源版本")
        return identity

    @property
    def to_version_id(self) -> uuid.UUID:
        identity = self.to_model_id or self.to_rule_id
        if identity is None:
            raise ValueError("切换记录缺少目标版本")
        return identity
