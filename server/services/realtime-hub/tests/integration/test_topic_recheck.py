"""换票复核在真库上一条查询判完全部主题。"""

import pytest
from fastapi import FastAPI
from realtime_hub.container import Container

pytestmark = [pytest.mark.requires_postgres, pytest.mark.usefixtures("_clean")]


async def test_denied_topics_reads_the_real_declarations(
    application: FastAPI,
) -> None:
    """未登记与码不够的主题都判为订不了，其余照常放行。"""
    container: Container = application.state.container
    registry = container.registry
    await registry.declare(
        topic="opcua:recheck-1", required_code="opcua:view", publisher="test"
    )
    await registry.declare(
        topic="opcua:recheck-2", required_code="opcua:manage", publisher="test"
    )

    denied = await registry.denied_topics(
        topics=frozenset({"opcua:recheck-1", "opcua:recheck-2", "opcua:gone"}),
        codes=frozenset({"opcua:view"}),
    )

    assert denied == frozenset({"opcua:recheck-2", "opcua:gone"})
