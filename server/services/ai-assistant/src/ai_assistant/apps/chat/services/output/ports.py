"""层 7 输出的扩展点：一档 SSE 事件是什么形状。

⚠ 事件种类是**闭合集合**。放开成任意字符串的话，前端遇到没见过的种类只能静默
丢弃，而「助手做了一步但界面上没有」是这套东西最难查的一类故障。

⚠ 一档事件今天要同步四处（`events.py`、`api/advance.py` 的分帧、
`contracts/assistant.ts`、`turnRunner.ts`）。收成这一条声明之后，四处同步降成
一处加一条契约测试——漏一处的表现是那一档事件在界面上永远不出现。
"""

from dataclasses import dataclass

from pydantic import BaseModel


@dataclass(frozen=True)
class EventSpec:
    """一档事件。"""

    name: str
    # 载荷形状。⚠ 前端类型由它生成，不许两侧各写一份
    payload: type[BaseModel]
    # 给人看的一句：这一档什么时候出现。进不了线上，只给读代码的人
    note: str = ""
