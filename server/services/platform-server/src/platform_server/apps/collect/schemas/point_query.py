"""点位状态查询的闭合取值。"""

from typing import Literal

PointStatus = Literal["all", "abnormal", "waiting", "stale", "good"]
