"""调用者身份载体。只出结构，不认识任何具体权限码。"""

import uuid
from dataclasses import dataclass, field


@dataclass(frozen=True)
class CallerContext:
    """一次请求背后的主体：人或服务。"""

    user_id: uuid.UUID
    username: str
    role: str
    permissions: frozenset[str] = field(default_factory=frozenset[str])
    is_service: bool = False

    def has_all(self, codes: frozenset[str]) -> bool:
        """是否持有全部给定权限码。

        Args: codes。
        """
        return codes <= self.permissions

    def has_any(self, codes: frozenset[str]) -> bool:
        """是否持有其中任意一个权限码。空集合视为不满足。

        Args: codes。
        """
        return bool(codes & self.permissions)
