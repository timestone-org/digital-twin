"""闸 1 的身份缓存：把 `/verify` 每请求两条 SELECT 压成一个 TTL 一次。

⚠ 缓存是**进程内**的，与 `RouteRuleCache` 同构：写路径改完即失效，但只作用于
本副本，跨副本的收敛靠 TTL 兜底。于是停用账号 / 降权在**多副本**下最多滞后一个
TTL；单副本部署下写路径的失效是即时的。这是本缓存唯一的语义代价，别把 TTL
调大——它就是吊销窗口本身。

⚠ 缓存的是**脱库快照**而不是 `Identity`：后者持有 ORM 的 `User`，而那些关系是
`lazy="noload"`，跨会话再读属性拿到的是 None 而不是报错，最后炸在无关的地方。
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.services.identity import Identity
from lib.db.hooks import after_commit
from lib.utils.timeutils import Clock, utcnow

# 与 `RouteRuleCache` 取同一档：秒级即可挡掉绝大多数回源，又不至于让
# 「改了权限没反应」变成常见投诉
DEFAULT_CACHE_TTL_S = 10.0
# 条目数上限。缓存按用户分键，不封顶就是一条随在线用户数无限长的内存曲线
DEFAULT_MAX_ENTRIES = 4096


@dataclass(frozen=True)
class EdgeIdentity:
    """签身份头与闸 1 判定所需的全部字段，与数据库会话无关。"""

    user_id: uuid.UUID
    username: str
    role_name: str
    is_active: bool
    codes: frozenset[str]


def to_edge_identity(identity: Identity) -> EdgeIdentity:
    """把带 ORM 的身份视图拍成脱库快照。

    Args: identity。
    """
    return EdgeIdentity(
        user_id=identity.user.id,
        username=identity.user.username,
        role_name=identity.user.role.name,
        is_active=identity.user.is_active,
        codes=identity.codes,
    )


@dataclass
class IdentityCache:
    """闸 1 的身份缓存。写路径改完即失效，读路径按 TTL 兜底。"""

    ttl_s: float = DEFAULT_CACHE_TTL_S
    max_entries: int = DEFAULT_MAX_ENTRIES
    clock: Clock = utcnow
    _entries: dict[uuid.UUID, tuple[datetime, EdgeIdentity]] = field(
        default_factory=dict[uuid.UUID, tuple[datetime, EdgeIdentity]]
    )

    def get(self, user_id: uuid.UUID) -> EdgeIdentity | None:
        """取还没过期的那份；没有或已过期返回 None。

        Args: user_id。
        """
        found = self._entries.get(user_id)
        if found is None:
            return None
        loaded_at, identity = found
        if (self.clock() - loaded_at).total_seconds() >= self.ttl_s:
            del self._entries[user_id]
            return None
        return identity

    def put(self, identity: EdgeIdentity) -> None:
        """记下一份快照，必要时按写入顺序腾位置。

        Args: identity。
        """
        self._entries.pop(identity.user_id, None)
        while len(self._entries) >= self.max_entries:
            self._entries.pop(next(iter(self._entries)))
        self._entries[identity.user_id] = (self.clock(), identity)

    def invalidate(self, user_id: uuid.UUID) -> None:
        """丢掉某个账号的缓存。改角色 / 直权 / 启停用之后调。

        Args: user_id。
        """
        self._entries.pop(user_id, None)

    def invalidate_all(self) -> None:
        """整体丢弃。角色本身被改动时用——它牵动持有该角色的每个账号。"""
        self._entries.clear()


def invalidate_after_commit(
    session: AsyncSession, cache: IdentityCache, user_id: uuid.UUID
) -> None:
    """事务落地之后才丢掉这个账号的缓存。

    ⚠ 不许就地丢：提交还没落时丢掉，并发的 `/verify` 会当场用**旧**数据把它
    填回来，于是陈上整整一个 TTL——比不失效更糟，而且只在有并发时才出现。

    Args: session, cache, user_id。
    """

    async def _drop() -> None:
        cache.invalidate(user_id)

    after_commit(session, _drop)


def invalidate_all_after_commit(
    session: AsyncSession, cache: IdentityCache
) -> None:
    """事务落地之后整体丢弃。理由同上。

    Args: session, cache。
    """

    async def _drop() -> None:
        cache.invalidate_all()

    after_commit(session, _drop)
