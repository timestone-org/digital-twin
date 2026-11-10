"""求值视角下的一条行。单独成文件：窗口索引与历史折算都要用它，放进任何一边都成环。"""

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class RowSnapshot:
    """一条行在求值视角下的样子：时刻 + 全部列值（原始值 ∪ 计算值）。"""

    ts: datetime
    values: dict[str, object]

    def get(self, key: str) -> object:
        """取一列的值。

        Args: key。
        """
        return self.values.get(key)
