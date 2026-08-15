"""预测下发的取值目录：一拍的去向、点位类型、哨兵值。

口径见 docs/AC_PUBLISH_DESIGN.md §4。这里只放**字面量**，判定与拼装在
`services/ac_publish_*`。
"""

from platform_server.apps.hvac.startups import sql_values

# 一拍的去向。⚠ 三档必须分开：`degraded` 是「写进去了，但写的是哨兵值」，
# 与 `failed`（一个字节都没写进去）在现场是两回事——前者上位机读到 -1 会
# 走它自己的兜底逻辑，后者上位机读到的还是几小时前的旧值
PUBLISH_STATUS_OK = "ok"
PUBLISH_STATUS_DEGRADED = "degraded"
PUBLISH_STATUS_FAILED = "failed"

PUBLISH_STATUSES: frozenset[str] = frozenset(
    {PUBLISH_STATUS_OK, PUBLISH_STATUS_DEGRADED, PUBLISH_STATUS_FAILED}
)

PUBLISH_STATUS_VALUES = sql_values(PUBLISH_STATUSES)

# 区域推荐点位收的是文本
RECOMMENDATION_DATA_TYPE = "string"
# 组合时间点位收的是浮点。⚠ 整数型放不下 12.4，也放不下 §4.3 的哨兵语义
DURATION_DATA_TYPES = frozenset({"float", "double"})

# 「这一拍算不出数」的哨兵值。
# ⚠ 不可配置，且绝不能用 0：0 是**合法预测值**（一开机就已达标，现网占
# 48.7%），拿它当缺省会让上位机把「已经达标了」读成「没算出来」，或反过来
NO_PREDICTION = -1.0
# 字符串点位在降级时写的前缀，后面接人话原因
NO_PREDICTION_PREFIX = "无预测："
