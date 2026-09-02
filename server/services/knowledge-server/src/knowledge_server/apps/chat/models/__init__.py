"""对话域的表。

⚠ 每张表都要在这里再导出：迁移的 `env.py` 认的是 `Base.metadata`，
而漏 import 的那张表在 autogenerate 眼里是「该删掉的多余表」。
⚠ `Base` 与知识库那几张表**同一个**：一个 schema 一份 metadata，两份的话
autogenerate 会把对方的表判成多余。
"""

from knowledge_server.apps.chat.models.message import ChatMessage
from knowledge_server.apps.chat.models.session import ChatSession
from knowledge_server.apps.chat.models.step import ChatStep

__all__ = ["ChatMessage", "ChatSession", "ChatStep"]
