"""切分后测试支应用训练支统计量，保留标签原值。"""

from typing import Any
from uuid import UUID

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import (
    ENERGY,
    LOAD,
    PIPELINES,
    TEMPERATURE,
    create_pipeline,
    data_of,
    edge,
    node,
)
from integration.test_modeling_api import _run_pipeline, _seed_ledger
from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.modeling.models import ModelingNodeRun

pytestmark = pytest.mark.requires_postgres

TABLE = "post-split-scales"
TRAIN_COUNT = 90
TEST_SHIFT = 40.0


def _paired_graph(mode: str) -> dict[str, Any]:
    """切分后分别接两支；测试接线写在前面。Args: mode。"""
    train = node("train_scaler", "standardize")
    test = node(
        "test_scaler",
        "standardize",
        method="minmax" if mode == "different" else "zscore",
    )
    nodes = [
        node(
            "source",
            "ledger_source",
            table_code=TABLE,
            columns=[TEMPERATURE, LOAD, ENERGY],
        ),
        node("split", "split_dataset", target_column=ENERGY, test_ratio=0.25),
        test,
        node("model", "linear_regression"),
        node("metrics", "regression_metrics"),
    ]
    edges = [
        edge("source-split", "source", "frame", "split", "frame"),
        edge("test-transform", "split", "test", "test_scaler", "frame"),
        edge("test-model", "test_scaler", "frame", "model", "test"),
        edge("model-metrics", "model", "scored", "metrics", "scored"),
    ]
    if mode == "explicit-target":
        train["config"]["columns"] = test["config"]["columns"] = [
            TEMPERATURE,
            LOAD,
            ENERGY,
        ]
    if mode == "test-only":
        edges.append(edge("train-model", "split", "train", "model", "train"))
    else:
        nodes.append(train)
        edges.extend(
            [
                edge(
                    "train-transform", "split", "train", "train_scaler", "frame"
                ),
                edge("train-model", "train_scaler", "frame", "model", "train"),
            ]
        )
    if mode == "ambiguous":
        nodes.append(node("train_duplicate", "standardize"))
        edges.append(
            edge("train-extra", "split", "train", "train_duplicate", "frame")
        )
    return {"format_version": "1.0", "nodes": nodes, "edges": edges}


async def _shift_test_segment(session: AsyncSession, table_id: str) -> None:
    """只平移测试段数值，保留原回归关系。Args: session, table_id。"""
    rows = (
        await session.scalars(
            select(DatasetRecord)
            .where(DatasetRecord.table_id == UUID(table_id))
            .order_by(DatasetRecord.ts)
        )
    ).all()
    assert len(rows) == 120
    for row in rows[TRAIN_COUNT:]:
        values = dict(row.values_json)
        values[TEMPERATURE] += TEST_SHIFT
        values[ENERGY] += 2 * TEST_SHIFT
        row.values_json = values
    await session.commit()


@pytest.mark.parametrize("mode", ["paired", "explicit-target"])
async def test_post_split_test_branch_reuses_the_training_fit(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    mode: str,
) -> None:
    table = await _seed_ledger(app_client, db_session, TABLE)
    await _shift_test_segment(db_session, table)
    pipeline = await create_pipeline(
        app_client, "paired-scales", _paired_graph(mode)
    )
    run = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    assert run["status"] == "succeeded", run
    rows = (
        await db_session.scalars(
            select(ModelingNodeRun).where(
                ModelingNodeRun.run_id == UUID(run["id"])
            )
        )
    ).all()
    recorded = {row.node_id: row for row in rows}
    train = recorded["train_scaler"]
    test = recorded["test_scaler"]
    assert train.fitted_json is not None
    assert train.fitted_json[TEMPERATURE]["center"] == pytest.approx(
        24.1533333333
    )
    assert test.fitted_json == train.fitted_json
    assert ENERGY not in train.fitted_json
    assert train.ordinal < test.ordinal
    assert recorded["metrics"].preview_json["metrics"]["metrics"]["rmse"] < 1e-8


@pytest.mark.parametrize("mode", ["different", "test-only", "ambiguous"])
async def test_unmatched_test_fit_is_blocked_only_during_training(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    mode: str,
) -> None:
    table = await _seed_ledger(app_client, db_session, TABLE)
    await _shift_test_segment(db_session, table)
    pipeline = await create_pipeline(
        app_client, "unmatched-scales", _paired_graph(mode)
    )
    validation = await app_client.post(f"{PIPELINES}/{pipeline['id']}:validate")
    assert validation.status_code == 200
    assert data_of(validation)["is_valid"]
    run = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    assert run["status"] == "failed", run
    test = await db_session.scalar(
        select(ModelingNodeRun).where(
            ModelingNodeRun.run_id == UUID(run["id"]),
            ModelingNodeRun.node_id == "test_scaler",
        )
    )
    assert test is not None
    assert test.status == "failed"
    assert "无法复用训练参数" in test.error_text
    assert "test_scaler" in test.error_text
    assert test.fitted_json is None
    saved = await app_client.get(f"{PIPELINES}/{pipeline['id']}")
    assert data_of(saved)["graph"] == _paired_graph(mode)
