"""真实 OPC UA 会话验证一万个节点的兼容分页与完整性。"""

import asyncio
import os
import sys

from collector_server.apps.collect.drivers.base import DriverConnection
from collector_server.apps.collect.drivers.opcua.driver import OpcuaDriver

# 独立进程避免协议库标准地址空间初始化受父进程分支覆盖追踪影响。
SERVER_SOURCE = """
import asyncio
import signal
import sys
from asyncua import Server, ua

async def main():
    server = Server()
    await server.init()
    server.set_endpoint(sys.argv[1])
    namespace = await server.register_namespace('browse-paging-test')
    folder = await server.nodes.objects.add_folder(namespace, 'Large')
    nodes = []
    references = []
    for index in range(10_000):
        node_id = ua.NodeId(f'P{index}', namespace)
        name = ua.QualifiedName(f'P{index}', namespace)
        display_name = ua.LocalizedText(f'P{index}')
        nodes.append(ua.AddNodesItem(
            RequestedNewNodeId=node_id,
            BrowseName=name,
            NodeClass_=ua.NodeClass.Variable,
            TypeDefinition=ua.NodeId(ua.ObjectIds.BaseDataVariableType),
            NodeAttributes=ua.VariableAttributes(
                DisplayName=display_name,
                Value=ua.Variant(float(index), ua.VariantType.Double),
                DataType=ua.NodeId(ua.ObjectIds.Double),
                ValueRank=ua.ValueRank.Scalar,
            ),
        ))
        references.append(ua.ReferenceDescription(
            ReferenceTypeId=ua.NodeId(ua.ObjectIds.HasComponent),
            NodeId=node_id,
            BrowseName=name,
            DisplayName=display_name,
            NodeClass_=ua.NodeClass.Variable,
            TypeDefinition=ua.NodeId(ua.ObjectIds.BaseDataVariableType),
        ))
    assert not list(server.iserver.node_mgt_service.try_add_nodes(
        nodes, check=False
    ))
    server.iserver.aspace[folder.nodeid].references.extend(references)
    stopped = asyncio.Event()
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stopped.set)
    async with server:
        print(folder.nodeid.to_string(), flush=True)
        await stopped.wait()

asyncio.run(main())
"""


async def test_real_ten_thousand_node_folder_is_complete_and_bounded(
    unused_tcp_port: int,
) -> None:
    endpoint = f"opc.tcp://127.0.0.1:{unused_tcp_port}/browse-test"
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        SERVER_SOURCE,
        endpoint,
        # ⚠ 第三方服务器夹具不继承覆盖追踪；真实驱动仍在父进程收集分支覆盖。
        env={
            name: value
            for name, value in os.environ.items()
            if not name.startswith(("COVERAGE_", "COV_CORE_"))
        },
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    driver = OpcuaDriver(connection=DriverConnection(endpoint=endpoint))
    try:
        assert process.stdout is not None
        folder = (
            (await asyncio.wait_for(process.stdout.readline(), 60))
            .decode()
            .strip()
        )
        assert folder.startswith("ns=")
        await driver.connect()
        addresses: set[str] = set()
        token = None
        pages = 0
        while True:
            page = await driver.browse_page(folder, continuation_token=token)
            assert len(page.items) == 200
            assert all(item.data_type == "float" for item in page.items)
            addresses.update(item.address for item in page.items)
            pages += 1
            token = page.continuation_token
            if token is None:
                break
        assert pages == 50
        assert len(addresses) == 10_000
        assert "ns=2;s=P9999" in addresses
    finally:
        await driver.disconnect()
        if process.returncode is None:
            process.terminate()
            await asyncio.wait_for(process.wait(), 10)
