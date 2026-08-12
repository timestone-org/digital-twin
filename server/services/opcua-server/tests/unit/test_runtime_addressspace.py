"""地址空间的错误路径：删除失败与命名空间索引不符。

这两条都是**静默出错**的高发处，用假件把真实现不易构造的失败逼出来：
- `delete_nodes` 删不掉时不抛异常，失败写在返回的状态码里；
- 命名空间索引不是 2 时，全部已下发的 NodeId 会指错节点。
"""

from typing import Any

import pytest
from asyncua import ua

from opcua_server.apps.instance.errors import (
    InstanceStartFailed,
    NodeDeleteFailed,
)
from opcua_server.apps.instance.runtime.addressspace import (
    CUSTOM_NAMESPACE_INDEX,
    BuiltNode,
    NodeDefinition,
    delete_node,
    register_custom_namespace,
)

DEFINITION = NodeDefinition(
    identifier="plant.x", browse_name="X", data_type="int32"
)


class _FakeServer:
    """只实现被测路径用到的两个方法。"""

    def __init__(self, *, statuses: list[Any], namespace_index: int) -> None:
        self._statuses = statuses
        self._namespace_index = namespace_index
        self.deleted: list[Any] = []

    async def delete_nodes(self, nodes: list[Any]) -> tuple[list[Any], Any]:
        self.deleted = list(nodes)
        return nodes, self._statuses

    async def register_namespace(self, _uri: str) -> int:
        return self._namespace_index


def _server(
    *, statuses: list[Any] | None = None, namespace_index: int = 2
) -> Any:
    return _FakeServer(
        statuses=statuses if statuses is not None else [ua.StatusCode()],
        namespace_index=namespace_index,
    )


async def test_delete_succeeds_when_every_status_is_good() -> None:
    node = BuiltNode(definition=DEFINITION, handle=object())
    server = _server()
    await delete_node(server, node)
    assert server.deleted == [node.handle]


async def test_delete_raises_when_the_server_reports_a_bad_status() -> None:
    """⚠ 参考实现在这里吞掉失败并加了「备选方法」，对外仍报成功。"""
    node = BuiltNode(definition=DEFINITION, handle=object())
    bad = ua.StatusCode(ua.StatusCodes.BadNodeIdUnknown)
    with pytest.raises(NodeDeleteFailed, match="未能从地址空间移除"):
        await delete_node(_server(statuses=[bad]), node)


async def test_delete_failure_names_the_offending_node() -> None:
    node = BuiltNode(definition=DEFINITION, handle=object())
    bad = ua.StatusCode(ua.StatusCodes.BadUserAccessDenied)
    with pytest.raises(NodeDeleteFailed, match=DEFINITION.identifier):
        await delete_node(_server(statuses=[bad]), node)


async def test_namespace_index_two_is_accepted() -> None:
    index = await register_custom_namespace(_server(), "urn:x")
    assert index == CUSTOM_NAMESPACE_INDEX


async def test_unexpected_namespace_index_fails_loudly() -> None:
    """索引不是 2 时静默接受，会让全部 NodeId 指错节点。"""
    with pytest.raises(InstanceStartFailed, match="索引应为 2"):
        await register_custom_namespace(_server(namespace_index=3), "urn:x")
