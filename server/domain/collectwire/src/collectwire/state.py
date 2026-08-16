"""数据源采集运行态表的口径：collector 写、platform 只读（ADR-0003）。

跨 schema 读不许共享 ORM 模型，所以两侧各按这一份常量拼自己的 DDL 与查询。
⚠ 表名或列名漂了不会报错，只会让配置页上每个数据源都显示「还不知道」——
而那与「采集进程真的没起来」长得一模一样。
⚠ 这里只给**不带 schema 前缀**的表名：schema 名是各服务自己的配置。
"""

STATE_TABLE_NAME = "collect_source_states"

SOURCE_COLUMN = "source_id"
STATE_COLUMN = "state"
POINT_COUNT_COLUMN = "point_count"
ERROR_CATEGORY_COLUMN = "error_category"
ERROR_DETAIL_COLUMN = "error_detail"
LEADER_COLUMN = "leader_instance"
UPDATED_COLUMN = "updated_at"

STATE_COLUMNS = (
    SOURCE_COLUMN,
    STATE_COLUMN,
    POINT_COUNT_COLUMN,
    ERROR_CATEGORY_COLUMN,
    ERROR_DETAIL_COLUMN,
    LEADER_COLUMN,
    UPDATED_COLUMN,
)

STATE_CONNECTING = "connecting"
STATE_ONLINE = "online"
STATE_OFFLINE = "offline"
# ⚠ 顺序即 CHECK 约束的字面量顺序，与初始迁移逐字一致，动它会让模型与库里的
# 约束文本对不上
STATES = (STATE_CONNECTING, STATE_ONLINE, STATE_OFFLINE)

# ⚠ 采集侧从没写过这一行时读侧对外的取值，**不在库里出现**。不叫 offline：
# 「采集器压根没接手过它」与「接手了但连不上」处置完全不同——前者去看采集
# 进程活没活，后者去看现场
STATE_UNKNOWN = "unknown"

ERROR_CATEGORY_TRANSIENT = "transient"
ERROR_CATEGORY_CONFIG = "config"
ERROR_CATEGORY_AUTH = "auth"
ERROR_CATEGORIES = (
    ERROR_CATEGORY_TRANSIENT,
    ERROR_CATEGORY_CONFIG,
    ERROR_CATEGORY_AUTH,
)
