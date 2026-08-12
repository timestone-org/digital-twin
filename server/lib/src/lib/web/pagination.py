"""两种分页：页码用于有限集合，游标用于时序与大集合，见 api-contract §5.1。"""

import json
from base64 import urlsafe_b64decode, urlsafe_b64encode
from collections.abc import Mapping
from dataclasses import dataclass
from typing import cast

from fastapi import Query
from pydantic import BaseModel

from lib.errors.base import FieldError, ValidationFailed

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 200
DEFAULT_CURSOR_LIMIT = 100
CURSOR_FIELD = "after"


@dataclass(frozen=True)
class PageParams:
    """一次列表查询的分页入参。"""

    page: int
    size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


@dataclass(frozen=True)
class CursorParams:
    """一次游标翻页的入参。`after` 不透明，客户端不许解析或构造。"""

    limit: int
    after: str | None


class Page[ItemT](BaseModel):
    """页码分页的集合响应。`items` 永远是数组，空集合返回 `[]`。"""

    items: list[ItemT]
    page: int
    size: int
    total: int


class CursorPage[ItemT](BaseModel):
    """游标分页的集合响应。

    ⚠ 没有 `total`：时序集合算一次区间计数要全表扫，为一个用不上的数字
    把每次翻页拖慢十几倍不划算。
    """

    items: list[ItemT]
    next: str | None
    has_more: bool


def page_params(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
) -> PageParams:
    """分页依赖。超出 size 上限直接 400，不静默截断。

    Args: page, size。
    """
    return PageParams(page=page, size=size)


def cursor_params(
    limit: int = Query(default=DEFAULT_CURSOR_LIMIT, ge=1, le=MAX_PAGE_SIZE),
    after: str | None = Query(default=None),
) -> CursorParams:
    """游标分页依赖。超出 limit 上限直接 400，不静默截断。

    Args: limit, after。
    """
    return CursorParams(limit=limit, after=after)


def encode_cursor(payload: Mapping[str, str]) -> str:
    """把翻页锚点编成一个不透明游标。

    Args: payload。
    """
    compact = json.dumps(
        dict(payload), ensure_ascii=False, separators=(",", ":")
    )
    return urlsafe_b64encode(compact.encode("utf-8")).decode("ascii")


def decode_cursor(raw: str) -> dict[str, str]:
    """把游标解回翻页锚点；畸形输入按参数不合法拒绝。

    ⚠ 游标是客户端可以随手改的入参，任何一条解析失败的路径漏成异常
    就是一个 500。
    Args: raw。
    """
    try:
        payload = json.loads(urlsafe_b64decode(raw.encode("ascii")))
    except (ValueError, TypeError) as error:
        raise _cursor_rejected() from error
    entries = _as_text_map(payload)
    if entries is None:
        raise _cursor_rejected()
    return entries


def _as_text_map(payload: object) -> dict[str, str] | None:
    """把解出来的 JSON 收敛成字符串字典；形状不符返回 None。

    Args: payload。
    """
    if not isinstance(payload, dict):
        return None
    entries: dict[str, str] = {}
    # cast 的理由：isinstance 只能确认它是 dict，键值类型仍要逐个判
    for key, value in cast(dict[object, object], payload).items():
        if not isinstance(key, str) or not isinstance(value, str):
            return None
        entries[key] = value
    return entries


def _cursor_rejected() -> ValidationFailed:
    return ValidationFailed(
        "游标不可解析",
        details=(
            FieldError(
                field=CURSOR_FIELD,
                code="invalid_cursor",
                message="游标不可解析，请从上一页响应里原样带回",
            ),
        ),
    )
