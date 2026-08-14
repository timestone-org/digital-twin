"""本模块全部表的声明基类，绑定 `platform` schema（ADR-0003 写独占）。"""

from sqlalchemy import text

from lib.db import make_declarative_base
from platform_server.settings import DB_SCHEMA

Base = make_declarative_base(DB_SCHEMA)

EMPTY_JSON = text("'{}'::jsonb")  # 空覆盖 = 回退内置默认
