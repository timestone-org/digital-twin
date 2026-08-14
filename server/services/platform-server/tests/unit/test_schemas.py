"""入参模型的边界：多带字段即拒、空白名字即拒、批量有硬上限。

⚠ 这些约束一旦漏掉不会报错，只会让一条空名字或一个十万条的数组走到数据库
才出问题——那时报出来的是约束违例或超时，与真实原因隔得很远。
"""

import uuid

import pytest
from pydantic import ValidationError

from platform_server.apps.hvac.schemas import (
    MAX_RELOCATE_BATCH,
    AcUnitCreateIn,
    AcUnitRelocateIn,
    AcUnitUpdateIn,
    RoomCreateIn,
    WorkshopCreateIn,
)

ROOM_ID = uuid.UUID("3fa85f64-5717-4562-b3fc-2c963f66afa6")


def test_names_are_trimmed() -> None:
    assert WorkshopCreateIn(name="  一号车间  ").name == "一号车间"


@pytest.mark.parametrize("raw", ["", "   ", "x" * 65])
def test_names_outside_the_length_bounds_are_rejected(raw: str) -> None:
    with pytest.raises(ValidationError):
        WorkshopCreateIn(name=raw)


def test_unknown_fields_are_rejected() -> None:
    # extra="forbid"：拼错的字段名不会被静默忽略成「没传」
    with pytest.raises(ValidationError):
        WorkshopCreateIn.model_validate({"name": "一号车间", "nmae": "x"})


def test_creating_an_ac_unit_requires_a_room() -> None:
    with pytest.raises(ValidationError):
        AcUnitCreateIn.model_validate({"serial": "AC-001", "name": "东侧机"})


def test_creating_a_room_requires_a_workshop() -> None:
    with pytest.raises(ValidationError):
        RoomCreateIn.model_validate({"name": "注塑房"})


def test_an_update_with_no_fields_is_valid_and_changes_nothing() -> None:
    payload = AcUnitUpdateIn()
    assert payload.model_dump(exclude_unset=True) == {}


def test_relocate_rejects_an_empty_batch() -> None:
    with pytest.raises(ValidationError):
        AcUnitRelocateIn(ac_unit_ids=[], room_id=ROOM_ID)


def test_relocate_has_a_hard_batch_ceiling() -> None:
    # 无上限的批量入参等于一次 OOM，与分页上限同理
    too_many = [uuid.uuid4() for _ in range(MAX_RELOCATE_BATCH + 1)]
    with pytest.raises(ValidationError):
        AcUnitRelocateIn(ac_unit_ids=too_many, room_id=ROOM_ID)
