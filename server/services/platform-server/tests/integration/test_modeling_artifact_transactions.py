"""真实模型下载开始时，平台应已归还本次请求的数据库事务。"""

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from conftest import AppContext
from sqlalchemy import event
from sqlalchemy.orm import Session, SessionTransaction

from integration.modeling_helpers import (
    HTTP_CREATED,
    HTTP_OK,
    LOAD,
    TEMPERATURE,
    data_of,
)
from integration.test_modeling_anomaly_models_api import bind_call_fakes
from integration.test_modeling_formula_preview import binary_version
from integration.test_modeling_open_api import DEPLOYMENTS, OPEN

pytestmark = pytest.mark.requires_postgres


@contextmanager
def active_transactions() -> Iterator[set[Session]]:
    """观察这次业务操作实际获取过连接且尚未结束的会话。"""
    active: set[Session] = set()

    def started(
        session: Session, _transaction: SessionTransaction, _connection: object
    ) -> None:
        active.add(session)

    def ended(session: Session, transaction: SessionTransaction) -> None:
        if transaction.parent is None:
            active.discard(session)

    event.listen(Session, "after_begin", started)
    event.listen(Session, "after_transaction_end", ended)
    try:
        yield active
    finally:
        event.remove(Session, "after_begin", started)
        event.remove(Session, "after_transaction_end", ended)


async def test_binary_prediction_releases_database_before_reading_object(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    bind_call_fakes(app_context)
    client = app_context.client
    version = await binary_version(
        client,
        app_context.session,
        app_context.sessions,
        app_context.object_store,
    )
    created = await client.post(
        DEPLOYMENTS,
        json={
            "code": "artifact-transaction",
            "name": "合成预测",
            "model_version_id": version["id"],
        },
    )
    assert created.status_code == HTTP_CREATED, created.text
    reads: list[int] = []
    original = app_context.object_store.get_bytes
    with active_transactions() as active:

        async def read(key: str) -> bytes:
            reads.append(len(active))
            return await original(key)

        monkeypatch.setattr(app_context.object_store, "get_bytes", read)
        response = await client.post(
            f"{OPEN}/artifact-transaction:predict",
            json={"rows": [{TEMPERATURE: 25.0, LOAD: 430.0}]},
        )
    assert response.status_code == HTTP_OK, response.text
    assert len(data_of(response)["predictions"]) == 1
    assert reads == [0]
