"""主题对账：两个方向都要，且都不许让启动失败。

⚠ 守的是 ADR-0007 那条「注销按 at-least-once 处理，且必须有一条对账」。
漂移的两种后果各自都很难查：
- 主题**缺** → 那台实例永远推不出值，而页面上一切正常
- 主题**多** → 客户端订得上、也不报错，就是永远收不到数据

打真库：要对的就是「实例表 vs hub 清单」，实例表用假件等于没测那半边。
"""

import uuid

import httpx
import pytest

from opcua_server.apps.instance.deps import PERM_MANAGE
from opcua_server.apps.instance.services.realtime import topic_of
from opcua_server.apps.instance.services.topic_reconcile import TopicReconciler
from opcua_server.container import Container

pytestmark = [
    pytest.mark.requires_postgres,
    pytest.mark.usefixtures("clean_tables"),
]

INSTANCES = "/api/v1/opcua/instances"


@pytest.fixture
def container(app: httpx.ASGITransport) -> Container:
    """从整装应用上取组合根。

    ⚠ 取的是 app fixture 装配好的那一个（缓存与 hub 都已换成假件），
    另造一个会连真 Redis 与真 hub。

    Args: app。
    """
    built = app.app.state.container  # type: ignore[union-attr]  # 就是 FastAPI
    assert isinstance(built, Container)
    return built


class FakeRealtime:
    """记下对账做了哪些动作的假 hub 客户端。"""

    def __init__(self, *, listed: list[str] | None = None) -> None:
        self.listed = listed or []
        self.declared: list[uuid.UUID] = []
        self.revoked: list[str] = []

    async def topics(self) -> list[str]:
        return self.listed

    async def declare(self, instance_id: uuid.UUID) -> bool:
        self.declared.append(instance_id)
        return True

    async def revoke_topic(self, topic: str) -> bool:
        self.revoked.append(topic)
        return True


def _reconciler(
    container: Container, realtime: FakeRealtime
) -> TopicReconciler:
    return TopicReconciler(
        database=container.database,
        realtime=realtime,  # type: ignore[arg-type]  # 结构相同的假件
    )


async def _create(client: httpx.AsyncClient, headers: object, name: str) -> str:
    response = await client.post(
        INSTANCES,
        json={
            "name": name,
            "endpoint_path": f"/{name}",
            "namespace_uri": f"urn:test:{name}",
            "security_policies": ["NoSecurity"],
        },
        headers=headers(PERM_MANAGE),  # type: ignore[operator]  # fixture 是工厂
    )
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


async def test_a_missing_topic_is_declared_again(
    client: httpx.AsyncClient,
    sign_headers: object,
    container: Container,
) -> None:
    """⚠ 缺主题的实例永远推不出值，而页面上一切正常。"""
    instance_id = await _create(client, sign_headers, "recon-missing")
    realtime = FakeRealtime(listed=[])
    declared, revoked = await _reconciler(container, realtime).reconcile()
    assert uuid.UUID(instance_id) in realtime.declared
    assert declared >= 1
    assert revoked == 0


async def test_an_orphan_topic_is_revoked(
    client: httpx.AsyncClient,
    sign_headers: object,
    container: Container,
) -> None:
    """⚠ 实例没了主题还挂着：客户端订得上、不报错，就是收不到数据。"""
    instance_id = await _create(client, sign_headers, "recon-orphan")
    orphan = topic_of(uuid.uuid4())
    realtime = FakeRealtime(listed=[topic_of(uuid.UUID(instance_id)), orphan])
    declared, revoked = await _reconciler(container, realtime).reconcile()
    assert realtime.revoked == [orphan]
    assert revoked == 1
    # 已经在的那个不该被重复登记
    assert declared == 0


async def test_a_matching_pair_changes_nothing(
    client: httpx.AsyncClient,
    sign_headers: object,
    container: Container,
) -> None:
    instance_id = await _create(client, sign_headers, "recon-aligned")
    realtime = FakeRealtime(listed=[topic_of(uuid.UUID(instance_id))])
    declared, revoked = await _reconciler(container, realtime).reconcile()
    assert (declared, revoked) == (0, 0)
    assert realtime.declared == []
    assert realtime.revoked == []
