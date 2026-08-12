"""锁住对外口径：信封形状、HTTP 状态码必须真实、分页上限、时间序列化格式。"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated

import httpx
import pytest
from fastapi import APIRouter, Depends

from lib.errors import Conflict, NotFound, ValidationFailed
from lib.errors.base import FieldError
from lib.utils.timeutils import format_rfc3339
from lib.web import (
    ApiResponse,
    CursorPage,
    CursorParams,
    Page,
    PageParams,
    create_app,
    cursor_params,
    encode_cursor,
    ok,
    page_params,
)
from lib.web.pagination import MAX_PAGE_SIZE


def build_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/probe")

    async def success() -> ApiResponse[dict[str, str]]:
        return ok({"value": "x"})

    async def missing() -> ApiResponse[None]:
        raise NotFound("资源不存在")

    async def conflicting() -> ApiResponse[None]:
        raise Conflict("已存在")

    async def invalid() -> ApiResponse[None]:
        raise ValidationFailed(
            "参数校验失败",
            details=(
                FieldError(
                    field="period.start",
                    code="invalid_format",
                    message="应为 RFC3339 时间",
                ),
            ),
        )

    async def boom() -> ApiResponse[None]:
        raise RuntimeError("内部表名 secret_table 不该外泄")

    router.add_api_route("/ok", success, methods=["GET"])
    router.add_api_route("/missing", missing, methods=["GET"])
    router.add_api_route("/conflict", conflicting, methods=["GET"])
    router.add_api_route("/invalid", invalid, methods=["GET"])
    router.add_api_route("/boom", boom, methods=["GET"])
    return router


def build_paging_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/probe")

    async def paged(
        page: Annotated[PageParams, Depends(page_params)],
    ) -> ApiResponse[Page[str]]:
        return ok(Page[str](items=[], page=page.page, size=page.size, total=0))

    async def streamed(
        cursor: Annotated[CursorParams, Depends(cursor_params)],
    ) -> ApiResponse[CursorPage[str]]:
        return ok(
            CursorPage[str](
                items=[f"row-{cursor.limit}"],
                next=encode_cursor({"after": cursor.after or ""}),
                has_more=True,
            )
        )

    router.add_api_route("/paged", paged, methods=["GET"])
    router.add_api_route("/streamed", streamed, methods=["GET"])
    return router


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(
        title="probe",
        prefix="/api/v1/probe",
        routers=(build_router(), build_paging_router()),
    )
    # ⚠ raise_app_exceptions=False：Starlette 的兜底中间件生成 500 响应之后仍会
    # 重抛异常，不关掉就断言不到兜底处理器的输出
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as instance:
        yield instance


async def test_success_envelope_carries_code_message_and_trace_id(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/v1/probe/ok")
    body = response.json()
    assert response.status_code == 200
    assert body["code"] == 0
    assert body["message"] == "ok"
    assert body["data"] == {"value": "x"}
    assert len(body["trace_id"]) == 32


async def test_trace_id_follows_incoming_traceparent(
    client: httpx.AsyncClient,
) -> None:
    trace = "4bf92f3577b34da6a3ce929d0e0e4736"
    response = await client.get(
        "/api/v1/probe/ok",
        headers={"traceparent": f"00-{trace}-00f067aa0ba902b7-01"},
    )
    assert response.json()["trace_id"] == trace


@pytest.mark.parametrize(
    ("path", "status", "code"),
    [
        ("/api/v1/probe/missing", 404, 40003),
        ("/api/v1/probe/conflict", 409, 40004),
        ("/api/v1/probe/invalid", 400, 40001),
    ],
    ids=["not-found", "conflict", "validation"],
)
async def test_http_status_is_real_not_always_200(
    client: httpx.AsyncClient, path: str, status: int, code: int
) -> None:
    response = await client.get(path)
    assert response.status_code == status
    assert response.json()["code"] == code


async def test_field_errors_use_dotted_paths(
    client: httpx.AsyncClient,
) -> None:
    body = (await client.get("/api/v1/probe/invalid")).json()
    assert body["details"] == [
        {
            "field": "period.start",
            "code": "invalid_format",
            "message": "应为 RFC3339 时间",
        }
    ]


async def test_unhandled_exception_never_leaks_internals(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/v1/probe/boom")
    body = response.json()
    assert response.status_code == 500
    assert body["code"] == 50000
    assert "secret_table" not in body["message"]


async def test_liveness_probe_answers_without_dependencies(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get("/api/v1/probe/health")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


async def test_page_size_over_hard_cap_is_rejected_not_truncated(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get(f"/api/v1/probe/paged?size={MAX_PAGE_SIZE + 1}")
    assert response.status_code == 400
    assert response.json()["code"] == 40001


async def test_page_defaults_are_applied(
    client: httpx.AsyncClient,
) -> None:
    body = (await client.get("/api/v1/probe/paged")).json()
    assert body["data"] == {"items": [], "page": 1, "size": 20, "total": 0}


async def test_cursor_defaults_are_applied(
    client: httpx.AsyncClient,
) -> None:
    body = (await client.get("/api/v1/probe/streamed")).json()
    assert body["data"] == {
        "items": ["row-100"],
        "next": "eyJhZnRlciI6IiJ9",
        "has_more": True,
    }


async def test_cursor_collection_never_carries_a_total(
    client: httpx.AsyncClient,
) -> None:
    # ⚠ 时序集合算一次区间计数要全表扫，契约里就不该有这个字段
    body = (await client.get("/api/v1/probe/streamed")).json()
    assert "total" not in body["data"]


async def test_cursor_limit_over_hard_cap_is_rejected_not_truncated(
    client: httpx.AsyncClient,
) -> None:
    response = await client.get(
        f"/api/v1/probe/streamed?limit={MAX_PAGE_SIZE + 1}"
    )
    assert response.status_code == 400
    assert response.json()["code"] == 40001


def test_rfc3339_is_utc_with_millisecond_precision() -> None:
    moment = datetime(2026, 8, 10, 9, 30, 0, 123456, tzinfo=UTC)
    assert format_rfc3339(moment) == "2026-08-10T09:30:00.123Z"
