"""可开启短数据库事务的基础端口。"""

from contextlib import AbstractAsyncContextManager
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession


class Sessions(Protocol):
    """开一个短事务的最小面。

    ⚠ 只认这一个方法而不认 `Database`：下发要开三个互不相干的短事务
    （读配置、算、记心跳），把它收成一个面，用例才能把那条回滚事务包进来，
    而不必让被测代码知道自己跑在用例里。
    """

    def session(self) -> AbstractAsyncContextManager[AsyncSession]: ...
