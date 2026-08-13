"""按节点定义构建实例的地址空间。

三条硬约束（CONTEXT.md §2 不变式 3、4）：

- **命名空间索引钉死为 2。** 它是服务器按注册顺序分配的内部序号，不同实例
  未必给同一个 URI 分到同一个数；暴露给用户填等于把实现细节变成对外契约。
  这里只注册一个自定义命名空间，并断言拿到的就是 2，拿到别的就响亮失败。
- **标识由人给，永不自动改写。** 上位系统的组态里硬编码着 NodeId，这边换一
  个，现场所有组态一起废。冲突只能报错。
- **父节点缺失即报错，不挂到 Objects 根下。** 静默改挂点会让上位机按
  BrowsePath 寻址时全部落空，而它拿到的错误只是「找不到节点」。
"""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, cast

from asyncua import Server, ua

from opcua_server.apps.instance.errors import (
    InstanceStartFailed,
    NodeDeleteFailed,
    NodeIdentifierTaken,
    NodeNotFound,
)
from opcua_server.apps.instance.runtime.datatypes import (
    coerce,
    default_value,
    variant_type,
)

# 自定义命名空间恒为 2：0 是 OPC UA 标准空间，1 是服务器的 ApplicationUri
CUSTOM_NAMESPACE_INDEX = 2

NODE_CLASS_OBJECT = "object"
NODE_CLASS_VARIABLE = "variable"
NODE_CLASS_PROPERTY = "property"
# 带值的两类：只有它们需要数据类型与初值
VALUED_CLASSES = frozenset({NODE_CLASS_VARIABLE, NODE_CLASS_PROPERTY})
# 运行时能建出来的全部类别。`method` 不在其中，理由见 CONTEXT.md §3。
BUILDABLE_CLASSES = frozenset({NODE_CLASS_OBJECT}) | VALUED_CLASSES
# 没给数据类型的带值节点按字符串建，与库里 data_type 可空的口径一致
FALLBACK_DATA_TYPE = "string"


@dataclass(frozen=True)
class NodeDefinition:
    """一个节点的定义。`identifier` 是 NodeId 里由人指定的那一段。

    `data_type` 与 `initial_value` 只对 variable / property 有意义；
    object 节点留空，与 `opcua_nodes.data_type` 可空的口径一致。
    """

    identifier: str
    browse_name: str
    data_type: str | None = None
    initial_value: object | None = None
    is_writable: bool = True
    node_class: str = NODE_CLASS_VARIABLE
    # 父节点的标识。留空表示直接挂在 Objects 根下。
    parent_identifier: str | None = None

    def node_id(self) -> str:
        """完整的字符串型 NodeId，索引恒为 2。"""
        return f"ns={CUSTOM_NAMESPACE_INDEX};s={self.identifier}"

    def qualified_name(self) -> str:
        """带命名空间的 BrowseName。

        ⚠ 必须显式带上索引 2。asyncua 收到裸字符串时会把 BrowseName 放进
        **命名空间 0**——那是 OPC UA 的标准空间，自定义节点挤进去既不合规，
        也可能与标准名撞车；而上位机 Browse 出来才看得见，管理面完全无感。
        """
        return f"{CUSTOM_NAMESPACE_INDEX}:{self.browse_name}"

    def has_value(self) -> bool:
        """这个类别的节点带不带值。"""
        return self.node_class in VALUED_CLASSES


@dataclass(frozen=True)
class BuiltNode:
    """建成的节点：定义 + asyncua 的 Node 句柄。"""

    definition: NodeDefinition
    handle: Any


async def register_custom_namespace(server: Server, uri: str) -> int:
    """注册实例的自定义命名空间，并断言索引是 2。

    ⚠ 拿到别的索引说明启动顺序被改过；此时静默接受会让所有已下发的 NodeId
    全部指错节点，而上位机只会报「节点不存在」。

    Args: server, uri。
    """
    index = cast(int, await cast(Any, server).register_namespace(uri))
    if index != CUSTOM_NAMESPACE_INDEX:
        raise InstanceStartFailed(
            f"自定义命名空间的索引应为 {CUSTOM_NAMESPACE_INDEX}，实得 {index}"
        )
    return index


def order_by_depth(
    definitions: list[NodeDefinition],
) -> list[NodeDefinition]:
    """把定义排成「先父后子」，父节点缺失或成环即抛。

    ⚠ 不能按输入顺序建：父节点还没建出来时，子节点无处可挂。而**静默挂到
    根下**会让上位机的 BrowsePath 全错，且错得毫无线索——所以缺父就报错。

    Args: definitions。
    """
    known = {definition.identifier for definition in definitions}
    for definition in definitions:
        parent = definition.parent_identifier
        if parent is not None and parent not in known:
            raise NodeNotFound(
                f"节点 {definition.identifier} 的父节点 {parent} 不存在"
            )
    ordered: list[NodeDefinition] = []
    placed: set[str] = set()
    remaining = list(definitions)
    while remaining:
        ready = [
            definition
            for definition in remaining
            if definition.parent_identifier is None
            or definition.parent_identifier in placed
        ]
        if not ready:
            stuck = sorted(item.identifier for item in remaining)
            raise InstanceStartFailed(f"节点的父子关系成环：{stuck}")
        ordered.extend(ready)
        placed.update(definition.identifier for definition in ready)
        ready_ids = {definition.identifier for definition in ready}
        remaining = [
            definition
            for definition in remaining
            if definition.identifier not in ready_ids
        ]
    return ordered


async def build_nodes(
    server: Server, definitions: list[NodeDefinition]
) -> dict[str, BuiltNode]:
    """把定义建成地址空间里的节点树，返回按标识索引的表。

    Args: server, definitions。
    """
    seen: set[str] = set()
    for definition in definitions:
        if definition.identifier in seen:
            raise NodeIdentifierTaken(
                f"标识 {definition.identifier} 在本实例内重复"
            )
        seen.add(definition.identifier)
    built: dict[str, BuiltNode] = {}
    root = server.get_objects_node()
    for definition in order_by_depth(definitions):
        parent = _parent_handle(root, built, definition)
        built[definition.identifier] = await add_node(parent, definition)
    return built


def _parent_handle(
    root: Any, built: dict[str, BuiltNode], definition: NodeDefinition
) -> Any:
    """取父节点句柄；没指定父节点就挂在 Objects 根下。

    Args: root, built, definition。
    """
    parent = definition.parent_identifier
    if parent is None:
        return root
    found = built.get(parent)
    if found is None:
        raise NodeNotFound(
            f"节点 {definition.identifier} 的父节点 {parent} 不存在"
        )
    return found.handle


async def add_node(parent: Any, definition: NodeDefinition) -> BuiltNode:
    """在给定父节点下建一个节点。

    加完即刻可被上位机 Browse 与 Read——这正是 CONTEXT.md §6 把「加节点」
    列进热生效档的依据：现场加点是常规操作，为它重启会踢掉全部会话。

    Args: parent, definition。
    """
    if definition.node_class not in BUILDABLE_CLASSES:
        raise InstanceStartFailed(
            f"不支持的节点类别 {definition.node_class}"
            f"（可建：{sorted(BUILDABLE_CLASSES)}）"
        )
    if definition.node_class == NODE_CLASS_OBJECT:
        handle = await parent.add_object(
            definition.node_id(), definition.qualified_name()
        )
        return BuiltNode(definition=definition, handle=handle)
    return await _add_valued(parent, definition)


async def _add_valued(parent: Any, definition: NodeDefinition) -> BuiltNode:
    """建一个带值的节点（variable / property）并按可写性设访问级别。

    只读节点保持 asyncua 建出来的默认（仅 CurrentRead）；可写的额外置上
    CurrentWrite 与 UserAccessLevel，这两位都置才是上位机真的能写。

    Args: parent, definition。
    """
    factory = (
        parent.add_property
        if definition.node_class == NODE_CLASS_PROPERTY
        else parent.add_variable
    )
    handle = await factory(
        definition.node_id(),
        definition.qualified_name(),
        _initial_of(definition),
        varianttype=variant_type(_data_type_of(definition)),
    )
    if definition.is_writable:
        await handle.set_writable(True)
    return BuiltNode(definition=definition, handle=handle)


def _data_type_of(definition: NodeDefinition) -> str:
    """带值节点的数据类型；没给就按字符串。

    Args: definition。
    """
    return definition.data_type or FALLBACK_DATA_TYPE


async def rewrite_writable(node: BuiltNode, *, is_writable: bool) -> BuiltNode:
    """按新的可写位改一个已建成的节点，返回换好定义的新条目。

    `set_writable` 同时置/清 AccessLevel 与 UserAccessLevel 的 CurrentWrite
    位——两位都动才是上位机真的可写（契约测试钉死）。

    ⚠ 调用方必须用返回值**换掉**表里的条目：definition 是 frozen dataclass，
    留着旧的 is_writable，管理面写值的可写检查就还照旧口径走。

    Args: node, is_writable。
    """
    await node.handle.set_writable(is_writable)
    return BuiltNode(
        definition=replace(node.definition, is_writable=is_writable),
        handle=node.handle,
    )


def subtree_of(nodes: Mapping[str, BuiltNode], identifier: str) -> list[str]:
    """`identifier` 及其全部后代，**子在前、父在后**。

    删除要按这个顺序走：先摘子再摘父，中途失败时留下的是一棵仍然连通的
    树，而不是一堆挂在已删父节点下的孤儿。

    Args: nodes, identifier。
    """
    children: dict[str, list[str]] = {}
    for key, node in nodes.items():
        parent = node.definition.parent_identifier
        if parent is not None:
            children.setdefault(parent, []).append(key)
    ordered: list[str] = []

    def walk(current: str) -> None:
        for child in sorted(children.get(current, ())):
            walk(child)
        ordered.append(current)

    walk(identifier)
    return ordered


async def delete_node(server: Server, node: BuiltNode) -> None:
    """从**已经在跑**的地址空间里移除一个节点。

    ⚠ 必须查 `delete_nodes` 回来的状态码：它不抛异常，失败是写在返回值里的。
    参考实现在这里吞掉异常又加了个「备选删除方法」，结果是删不掉时对外仍报
    成功，节点留在地址空间里而管理面以为它没了——本仓一律抛出。

    Args: server, node。
    """
    outcome = await cast(Any, server).delete_nodes([node.handle])
    statuses = cast(tuple[Any, Any], outcome)[1]
    bad = [
        status
        for status in cast(list[Any], statuses)
        if not cast(bool, status.is_good())
    ]
    if bad:
        raise NodeDeleteFailed(
            f"节点 {node.definition.identifier} 未能从地址空间移除："
            f"{cast(str, bad[0].name)}"
        )


def _initial_of(definition: NodeDefinition) -> object:
    """节点初值：给了就校验，没给就用该类型的默认值。

    Args: definition。
    """
    data_type = _data_type_of(definition)
    if definition.initial_value is None:
        return default_value(data_type)
    return coerce(definition.initial_value, data_type)


async def write_node_value(node: BuiltNode, value: object) -> object:
    """把值写进节点，返回收敛后的实际值。

    值的权威源是**进程内存**（CONTEXT.md §2 不变式 1）：这里写的是 asyncua
    的地址空间，不落库，重启回初值。

    Args: node, value。
    """
    data_type = _data_type_of(node.definition)
    coerced = coerce(value, data_type)
    await node.handle.write_value(ua.Variant(coerced, variant_type(data_type)))
    return coerced


async def read_node_value(node: BuiltNode) -> object:
    """读节点当前值。

    Args: node。
    """
    return cast(object, await node.handle.read_value())
