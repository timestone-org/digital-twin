"""本服务全部表的声明基类，绑定 `knowledge` schema（ADR-0003 写独占）。

⚠ 放在服务级而不是某个功能模块下：两个功能模块（知识库、对话）的表要落进
**同一份** metadata——各造一份的话，迁移的 autogenerate 会把对方的表判成多余。
"""

from knowledge_server.settings import DB_SCHEMA
from lib.db import make_declarative_base

Base = make_declarative_base(DB_SCHEMA)
