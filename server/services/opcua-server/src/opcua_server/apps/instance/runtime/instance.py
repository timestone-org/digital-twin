"""单个 OPC UA 实例的生命周期。

三条与参考实现不同的地方，都是有意的：

- **不用 `while flag: await sleep(1)` 当主循环。** `Server.start()` 起完监听
  就返回，asyncua 自己持有连接处理任务；再套一个轮询循环只是把「实例在跑」
  这件事变成一个可能与事实不符的标志位。
- **`is_listening()` 真的去连本地端口**（CONTEXT.md §2 不变式 5）。标志位说
  在跑而端口没开，是最难排查的一类故障。
- **值的权威源是进程内存**（不变式 1、2）：写进 asyncua 的地址空间，不落库，
  重启回初值——这是明确语义，不是缺陷。
"""

import asyncio
import contextlib
import socket
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any, cast
from uuid import UUID

from asyncua import Server, ua

from lib.logging import get_logger
from lib.utils.timeutils import Clock, utcnow
from opcua_server.apps.instance.errors import (
    InstanceAlreadyRunning,
    InstanceNotRunning,
    InstanceStartFailed,
    NodeIdentifierTaken,
    NodeNotFound,
    NodeNotWritable,
)
from opcua_server.apps.instance.runtime.addressspace import (
    BuiltNode,
    NodeDefinition,
    add_node,
    build_nodes,
    delete_node,
    read_node_value,
    register_custom_namespace,
    write_node_value,
)
from opcua_server.apps.instance.runtime.pki import PkiStore
from opcua_server.apps.instance.runtime.sessions import (
    SessionRecord,
    SessionRegistry,
    TrackingInternalServer,
)
from opcua_server.apps.instance.runtime.valuewatch import (
    OnValueChange,
    ValueWatcher,
)

_logger = get_logger("opcua.instance")

# 探活连不上就是没在监听，不需要更久——本地回环上 1 秒已经很宽
LISTEN_PROBE_TIMEOUT_S = 1.0
# 停止时等 asyncua 收尾的上限，超时就记一条并往下走，不无限等
STOP_TIMEOUT_S = 10.0

# 监听全网卡时的绑定地址；探活要把它换成回环
BIND_ALL = "0.0.0.0"  # noqa: S104  # 这是常量定义，绑定发生在 InstanceSpec.host
LOOPBACK = "127.0.0.1"


@dataclass(frozen=True)
class SecurityProfile:
    """实例的安全口径。默认禁匿名——发布面不该谁都能连。"""

    allow_anonymous: bool = False
    allow_username: bool = True
    allow_certificate: bool = True
    allow_insecure_transport: bool = False


@dataclass(frozen=True)
class InstanceSpec:
    """一个实例的全部启动参数。端口由端口池分配，不在这里挑。"""

    instance_id: UUID
    name: str
    port: int
    namespace_uri: str
    endpoint_path: str = "digitaltwin"
    # 容器内必须监听全部网卡，对外暴露哪一段由编排的端口映射决定
    host: str = BIND_ALL
    nodes: tuple[NodeDefinition, ...] = field(default_factory=tuple)
    security: SecurityProfile = field(default_factory=SecurityProfile)

    def endpoint_url(self) -> str:
        """上位机要连的地址。"""
        return f"opc.tcp://{self.host}:{self.port}/{self.endpoint_path}"

    def application_uri(self) -> str:
        """本实例的 ApplicationUri，证书 SAN 里要与它一致。"""
        return f"urn:digitaltwin:opcua:{self.instance_id}"


@contextlib.contextmanager
def _vanished(identifier: str) -> Generator[None]:
    """把「节点在读写途中被删掉」翻译成领域异常。

    ⚠ api-contract 不允许第三方异常穿透到响应：`UaStatusCodeError` 既没有本仓
    的错误码，也会把 asyncua 的内部措辞带进 message。

    Args: identifier。
    """
    try:
        yield
    except ua.UaStatusCodeError as error:
        raise NodeNotFound(f"节点 {identifier} 不存在于本实例") from error


def _probe_host(bind_host: str) -> str:
    """探活要连的地址：监听全网卡时连回环，否则连它自己。

    Args: bind_host。
    """
    return LOOPBACK if bind_host in (BIND_ALL, "") else bind_host


def _identity_tokens(security: SecurityProfile) -> list[Any]:
    """按安全口径给出允许的身份令牌类型。

    Args: security。
    """
    tokens: list[Any] = []
    if security.allow_anonymous:
        tokens.append(ua.AnonymousIdentityToken)
    if security.allow_username:
        tokens.append(ua.UserNameIdentityToken)
    if security.allow_certificate:
        tokens.append(ua.X509IdentityToken)
    return tokens


def _security_policies(security: SecurityProfile) -> list[Any]:
    """按安全口径给出端点的安全策略。

    ⚠ `NoSecurity` 只在显式允许时才开：默认开着等于把发布面裸奔在网上。

    Args: security。
    """
    policies: list[Any] = [
        ua.SecurityPolicyType.Basic256Sha256_SignAndEncrypt,
        ua.SecurityPolicyType.Basic256Sha256_Sign,
        ua.SecurityPolicyType.Aes128Sha256RsaOaep_SignAndEncrypt,
        ua.SecurityPolicyType.Aes128Sha256RsaOaep_Sign,
    ]
    if security.allow_insecure_transport:
        policies.insert(0, ua.SecurityPolicyType.NoSecurity)
    return policies


class RunningInstance:
    """一个已装配好的实例。start / stop 之外不持有后台循环。"""

    def __init__(
        self,
        spec: InstanceSpec,
        *,
        pki: PkiStore,
        clock: Clock = utcnow,
        on_value_change: OnValueChange | None = None,
    ) -> None:
        """按规格与证书库装配。

        ⚠ `on_value_change` 可缺省：不给就不建值监听，实例照常对上位机服务。
        实时推送是可选链路，不该由它决定实例能不能起。

        Args: spec, pki, clock, on_value_change。
        """
        self.spec = spec
        self._pki = pki
        self._watcher = (
            ValueWatcher(
                instance_id=spec.instance_id, on_change=on_value_change
            )
            if on_value_change is not None
            else None
        )
        self._registry = SessionRegistry(clock=clock)
        self._server: Server | None = None
        self._nodes: dict[str, BuiltNode] = {}
        # 地址空间的结构改动串行化；锁内只有进程内操作，没有跨进程 IO
        self._structure_lock = asyncio.Lock()

    @property
    def registry(self) -> SessionRegistry:
        """本实例的会话表。"""
        return self._registry

    def sessions(self) -> list[SessionRecord]:
        """当前在线会话。"""
        return self._registry.records()

    def node_identifiers(self) -> list[str]:
        """已建成的节点标识。"""
        return sorted(self._nodes)

    async def start(self) -> None:
        """建地址空间并起监听。已在跑则抛。"""
        if self._server is not None:
            raise InstanceAlreadyRunning(f"实例 {self.spec.name} 已在运行")
        server = await self._assemble()
        try:
            await server.start()
        except Exception as error:
            self._server = None
            self._nodes = {}
            raise InstanceStartFailed(
                f"实例 {self.spec.name} 启动失败：端口 {self.spec.port} 不可用"
            ) from error
        self._server = server
        if self._watcher is not None:
            await self._watcher.watch(
                server,
                {
                    identifier: built.handle
                    for identifier, built in self._nodes.items()
                },
            )
        _logger.info(
            "opcua_instance_started",
            "实例已监听",
            instance_id=str(self.spec.instance_id),
            port=self.spec.port,
        )

    async def _assemble(self) -> Server:
        """造一台配好证书、安全策略与地址空间的服务器。

        ⚠ 顺序有讲究：`set_application_uri` 必须在 `init()` 之后（它要写
        NamespaceArray）、在自定义命名空间注册之前（它占的是索引 1），
        也必须在 `start()` 之前——`start()` 会拿它去核对证书 SAN。
        """
        server = Server(iserver=TrackingInternalServer(self._registry))
        await server.init()
        # asyncua 的这几个 setter 形参无标注，在边界上一次性收敛
        configure = cast(Any, server)
        await server.set_application_uri(self.spec.application_uri())
        configure.set_endpoint(self.spec.endpoint_url())
        configure.set_server_name(self.spec.name)
        await self._apply_certificate(server)
        configure.set_security_policy(_security_policies(self.spec.security))
        configure.set_identity_tokens(_identity_tokens(self.spec.security))
        await register_custom_namespace(server, self.spec.namespace_uri)
        self._nodes = await build_nodes(server, list(self.spec.nodes))
        return server

    async def _apply_certificate(self, server: Server) -> None:
        """装上服务器证书与私钥。

        ⚠ SAN 的 DNSName 用**本机主机名**，不是实例名：asyncua 的
        `check_certificate` 拿 `socket.gethostname()` 去比，填实例名会让每次
        启动都刷一条「证书里没有主机名」的告警。

        Args: server。
        """
        material = await self._pki.ensure(
            self.spec.instance_id,
            application_uri=self.spec.application_uri(),
            hostname=socket.gethostname(),
        )
        loader = cast(Any, server)
        await loader.load_certificate(str(material.certificate_path))
        await loader.load_private_key(str(material.private_key_path))

    async def stop(self) -> None:
        """停监听并清空节点表。未在跑则无操作。"""
        server = self._server
        if server is None:
            return
        self._server = None
        self._nodes = {}
        # ⚠ 先撤订阅再停服务器：反过来的话，停机过程中的属性变化会触发回调，
        # 而那时节点表已经清空，回调只会记一串找不到标识的空转
        if self._watcher is not None:
            await self._watcher.stop()
        try:
            async with asyncio.timeout(STOP_TIMEOUT_S):
                await server.stop()
        except TimeoutError:
            _logger.warning(
                "opcua_instance_stop_timeout",
                "实例收尾超时，已放弃等待",
                instance_id=str(self.spec.instance_id),
            )
        _logger.info(
            "opcua_instance_stopped",
            "实例已停止",
            instance_id=str(self.spec.instance_id),
        )

    async def is_listening(
        self, timeout_s: float = LISTEN_PROBE_TIMEOUT_S
    ) -> bool:
        """真的去连一次本地端口，而不是读标志位。

        Args: timeout_s。
        """
        try:
            async with asyncio.timeout(timeout_s):
                _, writer = await asyncio.open_connection(
                    _probe_host(self.spec.host), self.spec.port
                )
        except (OSError, TimeoutError):
            return False
        writer.close()
        with contextlib.suppress(OSError):
            await writer.wait_closed()
        return True

    async def add_node(self, definition: NodeDefinition) -> BuiltNode:
        """运行中加一个节点，加完即刻可被上位机读到。

        ⚠ 标识冲突只报错，绝不自动改名——上位系统的组态里写死了 NodeId。
        ⚠ 父节点不存在也只报错，不改挂到根下：静默改挂点会让上位机按
        BrowsePath 寻址时落空，而它只会报「找不到节点」。

        Args: definition。
        """
        async with self._structure_lock:
            server = self._require_running()
            if definition.identifier in self._nodes:
                raise NodeIdentifierTaken(
                    f"标识 {definition.identifier} 在本实例内已存在"
                )
            parent = self._parent_handle(server, definition)
            node = await add_node(parent, definition)
            self._nodes[definition.identifier] = node
        _logger.info(
            "opcua_node_added",
            "运行中加节点",
            instance_id=str(self.spec.instance_id),
            identifier=definition.identifier,
            node_class=definition.node_class,
        )
        return node

    def _parent_handle(self, server: Server, definition: NodeDefinition) -> Any:
        """取父节点句柄；没指定父节点就挂在 Objects 根下。

        Args: server, definition。
        """
        parent = definition.parent_identifier
        if parent is None:
            return server.get_objects_node()
        found = self._nodes.get(parent)
        if found is None:
            raise NodeNotFound(f"父节点 {parent} 不存在于本实例")
        return found.handle

    def _subtree_of(self, identifier: str) -> list[str]:
        """`identifier` 及其全部后代，**子在前、父在后**。

        删除要按这个顺序走：先摘子再摘父，中途失败时留下的是一棵仍然连通的
        树，而不是一堆挂在已删父节点下的孤儿。

        Args: identifier。
        """
        children: dict[str, list[str]] = {}
        for key, node in self._nodes.items():
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

    async def remove_node(self, identifier: str) -> None:
        """运行中删一个节点及其后代，删完即刻不可被上位机读到。

        先从内部映射摘掉再动地址空间：这样并发的读写在摘掉那一刻起就拿到
        `NodeNotFound`，而不是拿到一个指向已删节点的句柄。地址空间那步失败
        时把映射放回去——否则管理面以为删了、上位机却还能读到。

        ⚠ 连后代一起删，是为了与库对齐：`opcua_nodes.parent_id` 上挂着
        `ON DELETE CASCADE`，只删自己会让子节点在库里没了、地址空间里还在。

        Args: identifier。
        """
        async with self._structure_lock:
            server = self._require_running()
            if identifier not in self._nodes:
                raise NodeNotFound(f"节点 {identifier} 不存在于本实例")
            removed: dict[str, BuiltNode] = {}
            try:
                for target in self._subtree_of(identifier):
                    node = self._nodes.pop(target)
                    removed[target] = node
                    await delete_node(server, node)
            except Exception:
                self._nodes.update(removed)
                raise
        _logger.info(
            "opcua_node_removed",
            "运行中删节点",
            instance_id=str(self.spec.instance_id),
            identifier=identifier,
            removed=len(removed),
        )

    def _require_running(self) -> Server:
        """取运行中的服务器句柄，没在跑就抛。"""
        if self._server is None:
            raise InstanceNotRunning(f"实例 {self.spec.name} 未运行")
        return self._server

    async def write_value(self, identifier: str, value: object) -> object:
        """写节点值，返回收敛后的实际值。

        ⚠ 查表与 `await` 之间可能插进一次 `remove_node`，此时 asyncua 会抛它
        自己的 `UaStatusCodeError`。给写路径加结构锁能消掉这个窗口，但那会让
        热路径排在结构改动后面——写值是上位机的常规操作，结构改动不是。
        因此选择在边界把它翻译成领域异常：**第三方异常不许穿透到响应**。

        Args: identifier, value。
        """
        node = self._require_node(identifier)
        if not node.definition.is_writable:
            raise NodeNotWritable(f"节点 {identifier} 不可写")
        with _vanished(identifier):
            return await write_node_value(node, value)

    async def read_value(self, identifier: str) -> object:
        """读节点当前值。

        Args: identifier。
        """
        node = self._require_node(identifier)
        with _vanished(identifier):
            return await read_node_value(node)

    def _require_node(self, identifier: str) -> BuiltNode:
        """取节点，取不到就抛。

        Args: identifier。
        """
        if self._server is None:
            raise InstanceNotRunning(f"实例 {self.spec.name} 未运行")
        node = self._nodes.get(identifier)
        if node is None:
            raise NodeNotFound(f"节点 {identifier} 不存在于本实例")
        return node
