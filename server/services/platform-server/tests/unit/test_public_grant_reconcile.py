"""匿名授权对账：发布态是权威，hub 那份授权清单是投影。

⚠ 两个方向都要真的成立：缺登记 → 公开页连得上通道却订不上主题（那张屏永远
只有静态快照）；多留一条 → 已经撤回的链接还能收实时值，而「撤回必须是真的」
是 ADR-0014 §二 的承诺。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

from platform_server.apps.dashboard.services.public_grants import (
    PublicGrantReconciler,
    ticket_fingerprint,
)
from platform_server.apps.dashboard.services.topics import (
    PUBLISHER_NAME,
    topic_of,
)
from unit.publish_fakes import FakeRealtime

FIRST = uuid.UUID("0198f0c0-0000-7000-8000-0000000000a1")
SECOND = uuid.UUID("0198f0c0-0000-7000-8000-0000000000a2")
TOKEN = "tok-first"
OTHER_TOKEN = "tok-second"


@dataclass
class FakePublishedIndex:
    """只回答「哪些屏在公开中、令牌是什么」的假件。"""

    rows: list[tuple[uuid.UUID, str]] = field(
        default_factory=list[tuple[uuid.UUID, str]]
    )

    async def published(self) -> list[tuple[uuid.UUID, str]]:
        return list(self.rows)


def build_reconciler(
    published: Sequence[tuple[uuid.UUID, str]], realtime: FakeRealtime
) -> PublicGrantReconciler:
    """装一个对账器，库那一侧换成固定名单。

    Args: published, realtime。
    """
    return PublicGrantReconciler(
        dashboards=FakePublishedIndex(list(published)), realtime=realtime
    )


async def test_a_published_screen_gets_its_grant_declared() -> None:
    realtime = FakeRealtime()
    declared, revoked = await build_reconciler(
        [(FIRST, TOKEN)], realtime
    ).reconcile()
    assert realtime.granted == [
        (ticket_fingerprint(TOKEN), topic_of(FIRST), PUBLISHER_NAME)
    ]
    assert (declared, revoked) == (1, 0)


async def test_the_token_itself_never_leaves_this_service() -> None:
    # ⚠ 送的是指纹：令牌是一枚可直接使用的凭据，让它落进通道服务的库里就等于
    # 多一处可被拖走的副本（ADR-0021）
    realtime = FakeRealtime()
    await build_reconciler([(FIRST, TOKEN)], realtime).reconcile()
    assert TOKEN not in [item[0] for item in realtime.granted]


async def test_a_revoked_link_loses_its_grant() -> None:
    stale = ticket_fingerprint(OTHER_TOKEN)
    realtime = FakeRealtime(known_grants=[ticket_fingerprint(TOKEN), stale])
    declared, revoked = await build_reconciler(
        [(FIRST, TOKEN)], realtime
    ).reconcile()
    assert realtime.revoked_grants == [stale]
    assert (declared, revoked) == (0, 1)


async def test_republishing_rotates_the_grant() -> None:
    # 每次发布都换新令牌，旧链接当场失效——授权必须跟着换
    old = ticket_fingerprint("tok-old")
    realtime = FakeRealtime(known_grants=[old])
    await build_reconciler([(FIRST, TOKEN)], realtime).reconcile()
    assert realtime.revoked_grants == [old]
    assert realtime.granted == [
        (ticket_fingerprint(TOKEN), topic_of(FIRST), PUBLISHER_NAME)
    ]


async def test_an_already_declared_grant_is_left_alone() -> None:
    realtime = FakeRealtime(known_grants=[ticket_fingerprint(TOKEN)])
    declared, revoked = await build_reconciler(
        [(FIRST, TOKEN)], realtime
    ).reconcile()
    assert realtime.granted == []
    assert (declared, revoked) == (0, 0)


async def test_an_unreachable_hub_revokes_nothing() -> None:
    # 取不到清单时输入为空：宁可多留一条授权一轮，也不要把全量公开链接清光
    realtime = FakeRealtime(
        known_grants=[ticket_fingerprint(OTHER_TOKEN)], is_reachable=False
    )
    declared, revoked = await build_reconciler(
        [(FIRST, TOKEN)], realtime
    ).reconcile()
    assert realtime.revoked_grants == []
    assert (declared, revoked) == (0, 0)


async def test_two_published_screens_get_one_grant_each() -> None:
    realtime = FakeRealtime()
    declared, _revoked = await build_reconciler(
        [(FIRST, TOKEN), (SECOND, OTHER_TOKEN)], realtime
    ).reconcile()
    assert {item[1] for item in realtime.granted} == {
        topic_of(FIRST),
        topic_of(SECOND),
    }
    assert declared == 2


def test_the_fingerprint_matches_the_hub_side_one() -> None:
    # ⚠ 指纹算法两侧各写一份（hub 的 `services/grants.ticket_fingerprint`），
    # 漂开的表现是所有公开链接一律订不上，而两边都不报错。钉同一个向量
    assert ticket_fingerprint("dt-public-ticket") == (
        "2c00fdc19fd6fb060a890ab340b565395c6c8b18d4a1ddfb7761373d23f7dffb"
    )
