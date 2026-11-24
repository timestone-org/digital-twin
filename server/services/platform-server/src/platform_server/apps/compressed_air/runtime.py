"""用既有采集与 OPC UA 端口装配空压站推荐循环。"""

from functools import partial

from platform_server.apps.collect.services import ReadOnlyHistorySource
from platform_server.apps.collect.services.state_source import SourceStateSource
from platform_server.apps.compressed_air.crud.calibration import load_curves
from platform_server.apps.compressed_air.services.publication import (
    LEASE_TTL_S,
    CompressedAirPublisher,
    PublicationSources,
)
from platform_server.container import Container
from platform_server.lease import RedisLease


def build_compressed_air(
    container: Container,
) -> tuple[CompressedAirPublisher, ...]:
    """仅为配置了四个推荐节点的部署装配发布循环。Args: container。"""
    settings = container.settings
    config = settings.compressed_air
    if config is None:
        return ()
    lease = RedisLease(
        url=settings.url(),
        key="platform:compressed-air:leader",
        token=settings.app_instance,
        ttl_s=LEASE_TTL_S,
        timeout_s=settings.redis_timeout_s,
    )
    return (
        CompressedAirPublisher(
            config,
            PublicationSources(
                container.snapshots,
                SourceStateSource(container.history),
                partial(
                    load_curves,
                    ReadOnlyHistorySource(container.history_database),
                    config,
                ),
            ),
            container.nodes,
            lease,
        ),
    )
