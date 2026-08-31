"""折叠那条路上的假件：记下折了几次、写了几次。

⚠ 真折要打模型，而这些用例数的是「该不该重折」——那是纯判断，不该被一次
网络调用拖着走。
"""

from ai_assistant.apps.chat.models import ChatMessage
from ai_assistant.apps.chat.services.memory.ports import Summary


class RecordingSummarizer:
    """按脚本作答，并记下拿到的上一段摘要。"""

    def __init__(self, answer: Summary | None) -> None:
        self.answer = answer
        self.calls = 0
        self.previous: Summary | None = None

    async def fold(
        self,
        dropped: list[ChatMessage],
        through_seq: int,
        previous: Summary | None,
    ) -> Summary | None:
        """记一次，回脚本里那一段。

        Args: dropped, through_seq, previous。
        """
        self.calls += 1
        self.previous = previous
        return self.answer


class RecordingSession:
    """只认 `execute` 的假库会话，记下写过几条。"""

    def __init__(self) -> None:
        self.written: list[object] = []

    async def execute(self, statement: object) -> None:
        """记下这条语句。

        Args: statement。
        """
        self.written.append(statement)
