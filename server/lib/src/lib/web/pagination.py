"""页码分页：有限集合的管理列表用。时序集合必须走游标，见 api-contract §5.1。"""

from dataclasses import dataclass

from fastapi import Query
from pydantic import BaseModel

DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 200


@dataclass(frozen=True)
class PageParams:
    """一次列表查询的分页入参。"""

    page: int
    size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


class Page[ItemT](BaseModel):
    """页码分页的集合响应。`items` 永远是数组，空集合返回 `[]`。"""

    items: list[ItemT]
    page: int
    size: int
    total: int


def page_params(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
) -> PageParams:
    """分页依赖。超出 size 上限直接 400，不静默截断。

    Args: page, size。
    """
    return PageParams(page=page, size=size)
