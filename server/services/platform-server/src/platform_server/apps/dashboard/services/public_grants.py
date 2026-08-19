"""匿名订阅授权的对账：把 hub 那边的「票据 → 主题」拉回与发布态一致。

与主题对账（`topic_reconcile.py`）同形，因为它们是同一件事的两半：主题决定
「这张屏推给谁」，授权决定「拿着公开链接的人能不能订它」。两边都可能漂：

- 发布了而 hub 当时不可达 → 授权**缺**。公开页连得上通道、订不上主题，
  表现是那张公开屏永远只有静态快照。
- 撤回了而 hub 当时不可达 → 授权**多**。一条已经撤回的链接还能收实时值，
  而这正是 ADR-0014 §二 说「撤回必须是真的」要挡的。

⚠ 送过去的是票据的**指纹**不是票据本身：票据是一枚可直接使用的凭据，让它落
进通道服务的库里就等于多一处可被拖走的副本（ADR-0021）。指纹算法两侧各写
一份，改它要两边一起改——漂开的表现是所有公开链接一律订不上，且两边都不报错。
"""

import hashlib
import uuid
from dataclasses import dataclass
from typing import Protocol

from lib.db import Database
from lib.logging import get_logger
from platform_server.apps.dashboard.crud import publish_crud
from platform_server.apps.dashboard.services.topics import (
    PUBLISHER_NAME,
    topic_of,
)
from platform_server.realtime import PublicGrantRegistrar

_logger = get_logger("platform.dashboard.grants")


def ticket_fingerprint(public_token: str) -> str:
    """一枚公开令牌的指纹。

    ⚠ 与 realtime-hub 的 `services/grants.ticket_fingerprint` 同算法，
    由两侧各一条契约用例钉住同一个向量。

    Args: public_token。
    """
    return hashlib.sha256(public_token.encode("utf-8")).hexdigest()


class PublishedIndex(Protocol):
    """发布态清单的最小查询面。对账拿它当权威。"""

    async def published(self) -> list[tuple[uuid.UUID, str]]: ...


@dataclass(frozen=True)
class DatabasePublishedIndex:
    """打本服务库的发布态清单。"""

    database: Database

    async def published(self) -> list[tuple[uuid.UUID, str]]:
        """仍在公开中的大屏及其令牌。"""
        async with self.database.session() as session:
            return await publish_crud.published_dashboards(session)


class PublicGrantReconciler:
    """让 hub 上的匿名授权与本服务的发布态对齐。"""

    def __init__(
        self, *, dashboards: PublishedIndex, realtime: PublicGrantRegistrar
    ) -> None:
        """按发布态清单与 hub 客户端初始化。

        Args: dashboards, realtime。
        """
        self._dashboards = dashboards
        self._realtime = realtime

    async def reconcile(self) -> tuple[int, int]:
        """补齐缺的、注销多的，返回 (补了几个, 注销了几个)。

        ⚠ 主题对账要排在本对账之前跑：授权指向的主题必须先登记，否则 hub 会以
        「主题未登记」拒掉这次登记。排错了不会坏，只是要多等一轮。
        ⚠ 单条失败不重试也不抛：下一轮还会再对一次。这一层重试会与「hub 正在
        重启」撞在一起，把一拍拖成一串超时。
        """
        published = await self._dashboards.published()
        expected = {
            ticket_fingerprint(token): topic_of(dashboard_id)
            for dashboard_id, token in published
        }
        actual = set(await self._realtime.grants(PUBLISHER_NAME))
        declared = await self._declare_missing(expected, actual)
        revoked = await self._revoke_extra(expected, actual)
        _logger.info(
            "public_grants_reconciled",
            "匿名授权对账完成",
            published=len(published),
            declared=declared,
            revoked=revoked,
        )
        return declared, revoked

    async def _declare_missing(
        self, expected: dict[str, str], actual: set[str]
    ) -> int:
        """给 hub 上缺的公开链接补登记。

        Args: expected, actual。
        """
        declared = 0
        for ticket_hash, topic in sorted(expected.items()):
            if ticket_hash in actual:
                continue
            declared += int(
                await self._realtime.declare_grant(
                    ticket_hash=ticket_hash,
                    topic=topic,
                    publisher=PUBLISHER_NAME,
                )
            )
        return declared

    async def _revoke_extra(
        self, expected: dict[str, str], actual: set[str]
    ) -> int:
        """注销已经撤回、授权还挂着的那些。

        ⚠ 方向单向：以 hub 的清单为输入。取不到清单时输入为空，于是什么都不
        注销——宁可多留一条授权一轮，也不要因为一次超时把全量公开链接清光。
        Args: expected, actual。
        """
        revoked = 0
        for ticket_hash in sorted(actual - set(expected)):
            revoked += int(await self._realtime.revoke_grant(ticket_hash))
        return revoked
