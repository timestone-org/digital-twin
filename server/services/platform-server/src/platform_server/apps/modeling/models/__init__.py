"""分析建模的全部 ORM 模型。

alembic 的 `env.py` 通过本文件收集元数据，故须维护 `__all__`：漏一个即迁移漏表。
"""

from platform_server.apps.modeling.models.artifact import (
    ModelingModelArtifact,
)
from platform_server.apps.modeling.models.base import Base
from platform_server.apps.modeling.models.binding import ModelingBinding
from platform_server.apps.modeling.models.command import ModelingCommand
from platform_server.apps.modeling.models.deployment import (
    ModelingApiKey,
    ModelingCallLog,
    ModelingDeployment,
)
from platform_server.apps.modeling.models.deployment_switch import (
    ModelingDeploymentSwitch,
)
from platform_server.apps.modeling.models.model_version import (
    ModelingModelVersion,
)
from platform_server.apps.modeling.models.operator_audit import (
    ModelingOperatorAudit,
)
from platform_server.apps.modeling.models.pipeline import ModelingPipeline
from platform_server.apps.modeling.models.rule_version import (
    ModelingRuleVersion,
)
from platform_server.apps.modeling.models.run import (
    MAX_ERROR_TEXT_LENGTH,
    ModelingNodeRun,
    ModelingRun,
)
from platform_server.apps.modeling.models.template import (
    ModelingConfigurationAudit,
    ModelingInstance,
    ModelingTemplate,
)

type ModelVersion = ModelingModelVersion | ModelingRuleVersion

__all__ = [
    "MAX_ERROR_TEXT_LENGTH",
    "Base",
    "ModelVersion",
    "ModelingApiKey",
    "ModelingBinding",
    "ModelingCallLog",
    "ModelingCommand",
    "ModelingConfigurationAudit",
    "ModelingDeployment",
    "ModelingDeploymentSwitch",
    "ModelingInstance",
    "ModelingModelArtifact",
    "ModelingModelVersion",
    "ModelingNodeRun",
    "ModelingOperatorAudit",
    "ModelingPipeline",
    "ModelingRuleVersion",
    "ModelingRun",
    "ModelingTemplate",
]
