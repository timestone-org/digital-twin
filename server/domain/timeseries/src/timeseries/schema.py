"""点位历史宽表的列契约：建表的迁移与读侧的查询共同引用这一份常量。

表结构、分块与压缩取值的实测理由见 docs/COLLECT_DESIGN.md §6。
"""

from datetime import timedelta

HISTORY_SCHEMA = "collect"
HISTORY_TABLE = "point_history"
HISTORY_COLUMNS = (
    "source_id",
    "point_code",
    "ts",
    "value_num",
    "value_text",
    "quality",
)
# 自然复合键，一物三用：幂等去重 / 主查询索引 / 分区约束
PRIMARY_KEY_COLUMNS = ("source_id", "point_code", "ts")
TIME_COLUMN = "ts"  # 超表的分区列
CHUNK_INTERVAL = timedelta(hours=6)
# ⚠ 永远不要从段键里拿掉 point_code：按点位删除会退化成解压整段
SEGMENT_BY = ("source_id", "point_code")
