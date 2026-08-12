"""在线会话追踪：子类注入，不是 monkey-patch。

`asyncua` 没有会话注册表——`InternalServer.create_session()` 只构造不登记，
标准的 `SessionDiagnosticsArray` 节点只有定义、没有任何代码往里写值。因此
拿会话生命周期的唯一干净办法是**子类化**（CONTEXT.md §5）：

    Server(iserver=TrackingInternalServer(...))   ← 构造参数，真实注入点
      └─ create_session(name, ...)            ← name 即 transport 的 peername
           └─ TrackedSession                      ← 激活/关闭时登记与注销

⚠ 绝不读 `InternalSession._current_connections`：那是**类属性**，会把进程内
全部实例的连接数加在一起（CONTEXT.md §4）。每个实例一份 SessionRegistry。

⚠ `asyncua` 不发布 py.typed，它的形参多数无标注，在 pyright strict 下是
Unknown。本模块在调用点用 `cast(Any, ...)` 把边界收敛掉，再用带标注的局部
变量收回具体类型——不使用 `type: ignore`，且收敛点只出现在这一个文件里。
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast

from asyncua.crypto.permission_rules import User, UserRole
from asyncua.server.internal_server import InternalServer
from asyncua.server.internal_session import InternalSession
from asyncua.server.user_managers import UserManager

from lib.utils.timeutils import Clock, utcnow


@dataclass(frozen=True)
class SessionRecord:
    """一条在线会话。对端来自 transport 的 peername。"""

    session_id: str
    peer: str
    username: str | None
    connected_at: datetime


def format_peer(name: object) -> str:
    """把 asyncua 传来的 peername 压成 `host:port`。

    ⚠ 它可能是 `('10.0.0.2', 51234)`，也可能已经是字符串，两种都要接住。

    Args: name。
    """
    if isinstance(name, tuple | list):
        parts = cast(tuple[object, ...], name)
        return ":".join(str(part) for part in parts)
    return str(name)


class SessionRegistry:
    """单个实例的在线会话表。每个实例一份，不共享、不用类属性。"""

    def __init__(self, *, clock: Clock = utcnow) -> None:
        """按时钟初始化。

        Args: clock（测试注入固定时钟）。
        """
        self._clock = clock
        self._records: dict[str, SessionRecord] = {}

    def activated(
        self, session_id: str, peer: object, username: str | None
    ) -> None:
        """会话激活：登记一条。

        Args: session_id, peer, username。
        """
        self._records[session_id] = SessionRecord(
            session_id=session_id,
            peer=format_peer(peer),
            username=username,
            connected_at=self._clock(),
        )

    def closed(self, session_id: str) -> None:
        """会话关闭：注销。未登记则无操作。

        Args: session_id。
        """
        self._records.pop(session_id, None)

    def records(self) -> list[SessionRecord]:
        """当前在线会话，按连接时刻升序。"""
        return sorted(
            self._records.values(), key=lambda item: item.connected_at
        )

    def count(self) -> int:
        """本实例的在线会话数。"""
        return len(self._records)


class TrackedSession(InternalSession):
    """会登记自己的会话。

    只在**激活成功后**登记：未激活的连接是「TCP 连上了但还没过鉴权」，
    把它算成在线会话会让页面上的数字比实际能读写的客户端多。
    """

    # 由 TrackingInternalServer.create_session 在构造后立刻装上
    registry: SessionRegistry

    def activate_session(self, params: Any, peer_certificate: Any) -> Any:
        """先让上游完成鉴权，通过了才登记。

        ⚠ 上游这个方法是**同步**的（不是协程）。签名漂移由契约测试拦住。

        Args: params, peer_certificate。
        """
        parent = cast(Any, super())
        result = parent.activate_session(params, peer_certificate)
        own = cast(Any, self)
        session_id = str(cast(object, own.session_id))
        peer: object = own.name
        user = cast(User, own.user)
        self.registry.activated(session_id, peer, user.name)
        return result

    async def close_session(self, delete_subs: bool = True) -> None:
        """先注销再让上游收尾，保证注册表不残留。

        ⚠ 形参名沿用上游的 `delete_subs`，不加本仓要求的 `should_` 前缀：
        pyright 会把覆盖方法的形参改名判成与基类不兼容（LSP），而命名闸的
        豁免是按文件登记的，两者冲突时以第三方定死的那个为准。
        豁免见 `scripts/gates/check_python_naming.py` 的 UPSTREAM_BOOL_NAMES。

        Args: delete_subs。
        """
        own = cast(Any, self)
        self.registry.closed(str(cast(object, own.session_id)))
        parent = cast(Any, super())
        await parent.close_session(delete_subs)


class TrackingInternalServer(InternalServer):
    """把 `create_session` 换成产出 TrackedSession 的版本。

    这是 `Server(iserver=...)` 要注入的那个对象。
    """

    def __init__(
        self,
        registry: SessionRegistry,
        user_manager: UserManager | None = None,
    ) -> None:
        """按注册表与用户管理器初始化。

        ⚠ 上游把 `user_manager` 标成必填却给了 `None` 默认值；这里不传，
        让它自己走「未指定即用宽松管理器」那条路，省掉为标注错误加的 cast。

        Args: registry, user_manager。
        """
        if user_manager is None:
            super().__init__()
        else:
            super().__init__(user_manager=user_manager)
        self.registry = registry

    def create_session(
        self,
        name: object,
        user: User | None = None,
        external: bool = False,
    ) -> TrackedSession:
        """产出会登记自己的会话。

        ⚠ 上游默认参数写作 `User(role=UserRole.Anonymous)`；这里用 None 哨兵
        等价替代——可变默认参数在函数定义时求值一次并被所有调用共享。

        Args: name, user, external。
        """
        own = cast(Any, self)
        session = TrackedSession(
            self,
            own.aspace,
            own.subscription_service,
            name,
            user=user if user is not None else User(role=UserRole.Anonymous),
            external=external,
        )
        session.registry = self.registry
        return session
