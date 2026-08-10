"""可注入的固定时钟。被测路径里禁止直接 `datetime.now()`。"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta


@dataclass
class FrozenClock:
    """固定时刻，可手动推进。"""

    current: datetime = field(
        default_factory=lambda: datetime(2026, 1, 1, tzinfo=UTC)
    )

    def __call__(self) -> datetime:
        return self.current

    def advance(self, seconds: float) -> datetime:
        """把时钟往前推。

        Args: seconds。
        """
        self.current += timedelta(seconds=seconds)
        return self.current
