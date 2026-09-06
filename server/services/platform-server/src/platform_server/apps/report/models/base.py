"""报告的独立元数据，归属 platform schema。"""

from lib.db import make_declarative_base
from platform_server.settings import DB_SCHEMA

Base = make_declarative_base(DB_SCHEMA)
