"""本模块全部表的声明基类，绑定 `auth` schema（ADR-0003 写独占）。"""

from auth_server.settings import DB_SCHEMA
from lib.db import make_declarative_base

Base = make_declarative_base(DB_SCHEMA)
