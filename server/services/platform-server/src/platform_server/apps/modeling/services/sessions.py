"""开一个短事务的最小面。

⚠ 只认这一个方法而不认 `Database`：worker 侧一次运行要开「认领」「取数」
「每个节点」「落终态」好几个互不相干的短事务，把它收成一个面，用例才能把那条
回滚事务包进来，而不必让被测代码知道自己跑在用例里。
⚠ 本模块自己声明一份，不去 import 台账那份同形协议：跨功能模块只走对方的
services 公开面，而一个只有一个方法的结构化协议复制一份比掰弯依赖方向便宜。
"""

from contextlib import AbstractAsyncContextManager
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession


class Sessions(Protocol):
    """开一个短事务的最小面。"""

    def session(self) -> AbstractAsyncContextManager[AsyncSession]: ...
