"""`opcua` schema 的全部 ORM 模型。

alembic 的 `env.py` 通过本文件收集元数据，故须维护 `__all__`：漏一个即迁移漏表。
"""

from opcua_server.apps.instance.models.base import Base
from opcua_server.apps.instance.models.credential import Credential
from opcua_server.apps.instance.models.instance import (
    DESIRED_STATES,
    SECURITY_POLICIES,
    Instance,
)
from opcua_server.apps.instance.models.node import (
    DATA_TYPES,
    IDENTIFIER_KINDS,
    NODE_CLASSES,
    Node,
)
from opcua_server.apps.instance.models.trusted_certificate import (
    TrustedCertificate,
)
from opcua_server.apps.instance.models.type_definition import (
    TYPE_KINDS,
    TypeDefinition,
)

__all__ = [
    "DATA_TYPES",
    "DESIRED_STATES",
    "IDENTIFIER_KINDS",
    "NODE_CLASSES",
    "SECURITY_POLICIES",
    "TYPE_KINDS",
    "Base",
    "Credential",
    "Instance",
    "Node",
    "TrustedCertificate",
    "TypeDefinition",
]
