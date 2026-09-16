"""工具列表的分页参数、边界与续查回执。"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

DEFAULT_LIMIT = 20
MAX_LIMIT = 20


@dataclass(frozen=True)
class ToolPage:
    """一页工具结果的窗口。"""

    page: int = 1
    limit: int = DEFAULT_LIMIT

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.limit

    @classmethod
    def parse(cls, arguments: Mapping[str, object]) -> "ToolPage":
        """校验工具参数；Args: arguments。"""
        page = arguments.get("page", 1)
        limit = arguments.get("limit", DEFAULT_LIMIT)
        if type(page) is not int or page < 1:
            raise ValueError("page 必须是大于等于 1 的整数")
        if type(limit) is not int or not 1 <= limit <= MAX_LIMIT:
            raise ValueError(f"limit 必须是 1 到 {MAX_LIMIT} 的整数")
        return cls(page=page, limit=limit)

    def metadata(
        self, *, has_more: bool, total: int | None = None
    ) -> dict[str, object]:
        """生成下一页提示；Args: has_more, total。"""
        return {
            "page": self.page,
            "limit": self.limit,
            "total": total,
            "has_more": has_more,
            "next_page": self.page + 1 if has_more else None,
        }

    def select[T](self, rows: Sequence[T]) -> list[T]:
        """截取本页；Args: rows。"""
        return list(rows[self.offset : self.offset + self.limit])

    def describe(self, total: int) -> dict[str, object]:
        return self.metadata(
            has_more=self.offset + self.limit < total, total=total
        )


def page_properties() -> dict[str, object]:
    """分页工具的 JSON Schema 属性。"""
    return {
        "page": {
            "type": "integer",
            "minimum": 1,
            "default": 1,
            "description": (
                "页码，首次为1；继续查询时使用next_page，" "保持筛选与limit不变"
            ),
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": MAX_LIMIT,
            "default": DEFAULT_LIMIT,
            "description": "单次返回条数，默认20，最多20",
        },
    }
