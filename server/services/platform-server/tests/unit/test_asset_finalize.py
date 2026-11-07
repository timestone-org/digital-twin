"""确认直传的幂等：重复调用与上一次半途失败之后的重试。"""

import datetime as dt
import uuid
from dataclasses import dataclass, field
from typing import Any, cast

import pytest

from lib.testing import FakeObjectStore
from platform_server.apps.assets import crud, keys
from platform_server.apps.assets.errors import AssetUploadMissing
from platform_server.apps.assets.models import Asset, AssetModelVariant
from platform_server.apps.assets.schemas import AssetOut
from platform_server.apps.assets.services import asset_service

ASSET_ID = uuid.UUID("0192f0aa-0000-7000-8000-000000000004")
REQUEST = asset_service.FinalizeRequest(name="pump", actor="tester")
GLB = b"glTF-ish bytes"


class FakeSession:
    async def flush(self) -> None:
        return None


def model_row(*, size_bytes: int = 1) -> Asset:
    return Asset(
        id=ASSET_ID,
        kind="model",
        name="pump",
        content_type="model/gltf-binary",
        size_bytes=size_bytes,
        checksum="etag",
        created_at=dt.datetime.now(dt.UTC),
        created_by="tester",
    )


@dataclass
class FakeTables:
    """素材表与档位表的替身。"""

    asset: Asset | None = None
    rows: list[AssetModelVariant] = field(
        default_factory=list[AssetModelVariant]
    )
    written: list[crud.AssetWrite] = field(
        default_factory=list[crud.AssetWrite]
    )

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def get(_session: object, _asset_id: uuid.UUID) -> Asset | None:
            return self.asset

        async def list_for_asset(
            _session: object, _asset_id: uuid.UUID
        ) -> list[AssetModelVariant]:
            return self.rows

        async def seed_pending(*_args: object) -> None:
            return None

        async def insert_if_absent(
            _session: object, write: crud.AssetWrite
        ) -> None:
            self.written.append(write)
            self.asset = model_row(size_bytes=write.size_bytes)

        monkeypatch.setattr(crud, "get", get)
        monkeypatch.setattr(crud, "insert_if_absent", insert_if_absent)
        variants = crud.asset_variant
        monkeypatch.setattr(variants, "list_for_asset", list_for_asset)
        monkeypatch.setattr(variants, "seed_pending", seed_pending)


async def finalize(store: FakeObjectStore) -> AssetOut:
    return await asset_service.finalize_upload(
        cast(Any, FakeSession()), store, ASSET_ID, REQUEST
    )


async def test_finalizing_again_reports_the_real_variants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    done = AssetModelVariant(
        asset_id=ASSET_ID,
        variant="high",
        status="ready",
        size_bytes=7,
        checksum="sum",
        error="",
    )
    FakeTables(asset=model_row(), rows=[done]).install(monkeypatch)

    again = await finalize(FakeObjectStore())

    # ⚠ 一律报成 pending 的话，界面把压好的模型退回「压缩中」
    high = next(item for item in again.variants if item.variant == "high")
    assert (high.status, high.size_bytes) == ("ready", 7)


async def test_a_retry_after_a_lost_commit_adopts_the_promoted_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tables = FakeTables()
    tables.install(monkeypatch)
    store = FakeObjectStore()
    await store.put_bytes(
        keys.object_key("model", ASSET_ID),
        GLB,
        content_type="model/gltf-binary",
    )

    saved = await finalize(store)

    # 暂存件已被上一次搬走、库里的行随事务回滚：字节在正式前缀，补上这一行就好
    assert saved.id == ASSET_ID
    assert [write.size_bytes for write in tables.written] == [len(GLB)]
    assert tables.written[0].kind == "model"


async def test_finalizing_with_no_bytes_anywhere_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeTables().install(monkeypatch)

    with pytest.raises(AssetUploadMissing):
        await finalize(FakeObjectStore())
