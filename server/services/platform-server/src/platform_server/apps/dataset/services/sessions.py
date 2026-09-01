"""开一个短事务的最小面。

⚠ 只认这一个方法而不认 `Database`：装模型这件事在单行写、批量重算与 worker
回填三条路径上各有各的事务，把它收成一个面，用例才能把那条回滚事务包进来。
"""

from contextlib import AbstractAsyncContextManager
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession


class Sessions(Protocol):
    """开一个短事务的最小面。"""

    def session(self) -> AbstractAsyncContextManager[AsyncSession]: ...
