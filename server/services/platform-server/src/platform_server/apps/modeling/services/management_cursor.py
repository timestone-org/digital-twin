"""管理列表游标的范围绑定及稳定分页。"""

import hashlib
import uuid
from datetime import datetime

from pydantic import BaseModel

from lib.errors import ValidationFailed
from lib.web import CursorPage, Page, decode_cursor, encode_cursor
from platform_server.apps.modeling.schemas.management import (
    ManagementCursor,
    ManagementListQuery,
)


def query_fingerprint(query: ManagementListQuery, resource: str) -> str:
    payload = query.model_dump_json(
        exclude={"page", "size", "after", "limit", "pagination"}
    )
    return hashlib.sha256(f"{resource}:{payload}".encode()).hexdigest()


def read_cursor(
    query: ManagementListQuery, resource: str
) -> ManagementCursor | None:
    if query.after is None:
        return None
    try:
        payload = decode_cursor(query.after)
        if payload.get("scope") != query_fingerprint(query, resource):
            raise ValueError("scope")
        moment = datetime.fromisoformat(payload["created_at"])
        if moment.utcoffset() is None:
            raise ValueError("timezone")
        return ManagementCursor(moment, uuid.UUID(payload["id"]))
    except (ValueError, KeyError) as error:
        raise ValidationFailed(
            "游标无效或查询条件已改变，请从首页读取"
        ) from error


def paginate[ItemT: BaseModel](
    items: list[ItemT],
    total: int,
    query: ManagementListQuery,
    resource: str,
) -> Page[ItemT] | CursorPage[ItemT]:
    if query.pagination == "page":
        return Page(items=items, page=query.page, size=query.size, total=total)
    has_more = len(items) > query.limit
    selected = items[: query.limit]
    next_cursor = None
    if has_more and selected:
        final = selected[-1]
        moment = getattr(final, "created_at", None)
        identity = getattr(final, "id", None)
        if not isinstance(moment, datetime) or not isinstance(
            identity, uuid.UUID
        ):
            raise ValueError("游标条目缺少时间与标识")
        next_cursor = encode_cursor(
            {
                "scope": query_fingerprint(query, resource),
                "created_at": moment.isoformat(timespec="microseconds"),
                "id": str(identity),
            }
        )
    return CursorPage(items=selected, next=next_cursor, has_more=has_more)
