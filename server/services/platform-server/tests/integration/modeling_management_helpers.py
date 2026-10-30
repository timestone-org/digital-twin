"""管理契约所需的实例、成功运行和固定版本数据。"""

import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_modeling_templates import make_instance
from platform_server.apps.modeling.models import (
    ModelingModelVersion,
    ModelingRuleVersion,
    ModelingRun,
)


async def seed_versions(
    client: httpx.AsyncClient, session: AsyncSession
) -> tuple[str, list[str]]:
    instance = await make_instance(client)
    identity = uuid.UUID(instance["id"])
    versions: list[str] = []
    for number in (1, 2):
        run = ModelingRun(
            pipeline_id=identity,
            status="succeeded",
            graph_snapshot={},
            trigger="api",
        )
        session.add(run)
        await session.flush()
        version = ModelingModelVersion(
            pipeline_id=identity,
            run_id=run.id,
            version=number,
            name=f"版本 {number}",
            algo="linear_regression",
            task="regression",
            servable=True,
            serving_channel="json",
            serving_json={},
            feature_keys=["temperature"],
            target_key="energy",
            metrics_json={},
            fingerprint_json={},
            signature_json=signature(),
        )
        session.add(version)
        await session.flush()
        versions.append(str(version.id))
    await session.commit()
    return str(identity), versions


def signature() -> dict:
    return {
        "format_version": "1.0",
        "requires_timestamp": False,
        "inputs": [
            {
                "key": "temperature",
                "dtype": "number",
                "is_required": True,
                "default_on_missing": None,
                "unit": "C",
            }
        ],
        "output": {
            "key": "energy",
            "task": "regression",
            "dtype": "number",
            "unit": "kW",
        },
    }


async def seed_rule_versions(session: AsyncSession, instance: str) -> list[str]:
    identity = uuid.UUID(instance)
    versions: list[str] = []
    for number, kind in enumerate(
        ("unit_consumption", "equipment_efficiency"), start=3
    ):
        run = ModelingRun(
            pipeline_id=identity,
            status="succeeded",
            graph_snapshot={},
            trigger="api",
        )
        session.add(run)
        await session.flush()
        row = ModelingRuleVersion(
            pipeline_id=identity,
            run_id=run.id,
            version=number,
            name=kind,
            algo="energy_rules",
            task="rule_calculation",
            target_key=None,
            servable=True,
            serving_channel="json",
            feature_keys=["a", "b"],
            metrics_json={},
            fingerprint_json={},
            signature_json=rule_signature(),
            serving_json=rule_serving(kind),
        )
        session.add(row)
        await session.flush()
        versions.append(str(row.id))
    await session.commit()
    return versions


def rule_signature() -> dict:
    return {
        "inputs": [
            {"key": "a", "dtype": "number"},
            {"key": "b", "dtype": "number"},
        ],
        "output": {"task": "rule_calculation", "dtype": "object"},
    }


def rule_serving(kind: str) -> dict:
    fields = (
        {"energy": "a", "output": "b"}
        if kind == "unit_consumption"
        else {"useful_output": "a", "input_power": "b"}
    )
    return {
        "steps": [
            {
                "operator": "energy_rules",
                "config": {"kind": kind, "fields": fields},
            }
        ]
    }
