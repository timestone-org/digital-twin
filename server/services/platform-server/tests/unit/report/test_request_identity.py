"""幂等键派生只有一份：查缓存与落库用同一对 (request_key, digest)。

⚠ 两份派生一旦漂开，同一个 Idempotency-Key 的重试会拿到 409 或第二个任务，
而不是缓存的 202。存量行的 request_key 也按这条式子算出来，故钉死字面量。
"""

import hashlib
import json

import pytest
from unit.source_fakes import InMemoryStream

from platform_server.apps.report.errors import ReportInvalid
from platform_server.apps.report.services.render_service import (
    RenderContext,
    request_identity,
)


def context(key: str | None) -> RenderContext:
    return RenderContext(
        actor="author",
        stream=InMemoryStream(),
        timezone="UTC",
        idempotency_key=key,
    )


def test_the_identity_is_pinned_to_the_stored_formula() -> None:
    payload: dict[str, object] = {"period": "2026-08", "template_id": "t"}
    identity = request_identity(payload, context("k1"), "render")
    assert identity == (
        hashlib.sha256(b"author:render:k1").hexdigest(),
        hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest(),
    )


def test_no_key_means_no_identity() -> None:
    assert request_identity({}, context(None), "render") is None


def test_an_overlong_key_is_refused() -> None:
    with pytest.raises(ReportInvalid):
        request_identity({}, context("x" * 201), "import")
