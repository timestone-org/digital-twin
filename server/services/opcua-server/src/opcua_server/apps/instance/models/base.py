"""本模块全部表的声明基类，绑定 `opcua` schema（ADR-0003 写独占）。"""

from lib.db import make_declarative_base
from opcua_server.settings import DB_SCHEMA

Base = make_declarative_base(DB_SCHEMA)
