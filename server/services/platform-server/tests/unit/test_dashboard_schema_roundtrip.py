"""出参模型经 JSON 往返之后还得validate 得回来。

⚠ 幂等缓存存的是 `model_dump(mode="json", by_alias=True)`、取的是
`model_validate`（见 `services/idempotency.py`）。只给 `serialization_alias`
的字段会让这条路断掉：dump 出的是别名、validate 只认字段名，于是**带幂等键的
重放请求 500**，而首次请求完全正常——测不到、也看不出来。
"""

import uuid
from datetime import UTC, datetime

from platform_server.apps.dashboard.schemas import NodeOut

GEOMETRY_ALIASES = ("x", "y", "w", "h")


def _node() -> NodeOut:
    now = datetime.now(UTC)
    return NodeOut(
        id=uuid.uuid4(),
        dashboard_id=uuid.uuid4(),
        parent_id=None,
        client_key=None,
        module_type="text-block",
        x_px=10,
        y_px=20,
        width_px=400,
        height_px=300,
        z_index=0,
        is_visible=True,
        config_json={},
        created_at=now,
        updated_at=now,
    )


def test_geometry_serializes_under_the_short_names() -> None:
    dumped = NodeOut.model_dump(_node(), mode="json", by_alias=True)

    assert all(alias in dumped for alias in GEOMETRY_ALIASES)


def test_a_node_survives_the_idempotency_cache_round_trip() -> None:
    # 这一条正是缓存重放走的那条路：dump 进缓存，validate 取回
    original = _node()

    restored = NodeOut.model_validate(
        original.model_dump(mode="json", by_alias=True)
    )

    assert (
        restored.x_px,
        restored.y_px,
        restored.width_px,
        restored.height_px,
    ) == (10, 20, 400, 300)


def test_construction_by_field_name_still_works() -> None:
    # presenter 一律按字段名构造；只给 alias（而非 validation_alias）会把合成
    # __init__ 的形参名换成别名，那样 pyright 会把每一处 presenter 判红
    assert _node().width_px == 400
