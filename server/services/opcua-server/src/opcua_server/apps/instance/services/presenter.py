"""把 ORM 行 + 运行时实况拼成对外模型。

⚠ ORM 模型不直接返给 HTTP 层（code-style-python.md）。更重要的是：出参里
一半字段来自库、一半来自运行时，只有在这里合流才说得清哪一半是哪一半。

⚠ `pending_fields` **不落库**，而是拿库里的配置与运行中实例的 spec 现场比对。
理由：没在跑的实例无所谓「未生效」——它下次起来读的就是库里的新值。
把它存下来反而会长出第三份真相，与库和运行时都可能不一致。
"""

from opcua_server.apps.instance.models import Instance, Node
from opcua_server.apps.instance.runtime.addressspace import (
    CUSTOM_NAMESPACE_INDEX,
    NodeDefinition,
)
from opcua_server.apps.instance.runtime.instance import RunningInstance
from opcua_server.apps.instance.schemas import (
    CertificateOut,
    InstanceOut,
    NodeOut,
)

# AccessLevel 的 CurrentWrite 位。OPC UA 用一个字节的位掩码表达访问级别。
ACCESS_LEVEL_WRITE = 0x2

# ⚠ `initial_value` 列是 JSONB 且模型标注为 `dict[str, object]`，而节点初值
# 是标量。统一封装成 `{"value": <标量>}`：直接存裸标量会让列的类型标注与
# 实际内容长期不符，读的人要靠猜。封装与拆封只在这里发生。
_VALUE_KEY = "value"


def wrap_value(value: object | None) -> dict[str, object] | None:
    """标量 → JSONB 的存储形状。

    Args: value。
    """
    return None if value is None else {_VALUE_KEY: value}


def unwrap_value(stored: dict[str, object] | None) -> object | None:
    """JSONB 的存储形状 → 标量。

    Args: stored。
    """
    return None if stored is None else stored.get(_VALUE_KEY)


def endpoint_url_of(row: Instance, host: str) -> str:
    """对外展示的 endpoint。host 由部署决定，不是实例配置的一部分。

    Args: row, host。
    """
    return f"opc.tcp://{host}:{row.port}{row.endpoint_path}"


def pending_fields_of(
    row: Instance, running: RunningInstance | None
) -> list[str]:
    """库里的配置与运行中的 spec 有哪些对不上。没在跑就是空表。

    Args: row, running。
    """
    if running is None:
        return []
    spec = running.spec
    differences = {
        "namespace_uri": row.namespace_uri != spec.namespace_uri,
        "endpoint_path": row.endpoint_path != f"/{spec.endpoint_path}",
        "port": row.port != spec.port,
        "is_anonymous_allowed": (
            row.is_anonymous_allowed != spec.security.allow_anonymous
        ),
    }
    return sorted(name for name, differs in differences.items() if differs)


def node_id_of(node: Node) -> str:
    """完整 NodeId。命名空间索引由系统钉死为 2（不变式 4）。

    Args: node。
    """
    kind = "i" if node.identifier_kind == "numeric" else "s"
    return f"ns={CUSTOM_NAMESPACE_INDEX};{kind}={node.identifier}"


def to_node_out(node: Node) -> NodeOut:
    """节点行 → 对外模型。

    Args: node。
    """
    return NodeOut(
        id=node.id,
        instance_id=node.instance_id,
        parent_id=node.parent_id,
        browse_name=node.browse_name,
        node_class=node.node_class,
        identifier=node.identifier,
        identifier_kind=node.identifier_kind,
        node_id=node_id_of(node),
        data_type=node.data_type,
        value_rank=node.value_rank,
        array_dimensions=node.array_dimensions,
        access_level=node.access_level,
        initial_value=unwrap_value(node.initial_value),
        description=node.description,
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


def to_instance_out(
    row: Instance,
    *,
    running: RunningInstance | None,
    is_running: bool,
    node_count: int,
    host: str,
) -> InstanceOut:
    """实例行 + 运行时实况 → 对外模型。

    Args: row, running, is_running, node_count, host。
    """
    return InstanceOut(
        id=row.id,
        name=row.name,
        description=row.description,
        endpoint_path=row.endpoint_path,
        port=row.port,
        namespace_uri=row.namespace_uri,
        security_policies=list(row.security_policies),
        is_anonymous_allowed=row.is_anonymous_allowed,
        is_autostart=row.is_autostart,
        desired_state=row.desired_state,
        is_running=is_running,
        has_pending_restart=row.has_pending_restart,
        pending_fields=pending_fields_of(row, running),
        endpoint_url=endpoint_url_of(row, host),
        node_count=node_count,
        session_count=len(running.sessions()) if running is not None else 0,
        certificate=CertificateOut(
            fingerprint=row.certificate_fingerprint,
            subject=row.certificate_subject,
            expires_at=row.certificate_expires_at,
        ),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def definitions_of(nodes: list[Node]) -> tuple[NodeDefinition, ...]:
    """节点行 → 运行时的节点定义，并把 `parent_id` 翻成父节点的**标识**。

    ⚠ 库里用行 id 表达父子，运行时按标识寻址（标识才是上位机看得见的那个）。
    翻译只在这里发生，缺了这一步父子关系会整棵丢失而不报错。

    Args: nodes。
    """
    identifier_of = {node.id: node.identifier for node in nodes}

    def parent_of(node: Node) -> str | None:
        parent_id = node.parent_id
        return None if parent_id is None else identifier_of.get(parent_id)

    return tuple(definition_of(node, parent_of(node)) for node in nodes)


def definition_of(node: Node, parent_identifier: str | None) -> NodeDefinition:
    """单行 → 定义。

    Args: node, parent_identifier。
    """
    return NodeDefinition(
        identifier=node.identifier,
        browse_name=node.browse_name,
        data_type=node.data_type,
        initial_value=unwrap_value(node.initial_value),
        is_writable=bool(node.access_level & ACCESS_LEVEL_WRITE),
        node_class=node.node_class,
        parent_identifier=parent_identifier,
    )
