"""缩略图的入参与出参。"""

import uuid

from pydantic import Field

from platform_server.apps.dashboard.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)

# 只收内联位图。⚠ 不收远程地址：缩略图会被渲染进工作台卡片，放行 http(s)
# 等于让任何一张屏的封面去打一个第三方地址，而页面上看不出来
DATA_URL_PREFIX = "data:image/"
# 至少要有前缀之后的一个字符，空图不是图
_MIN_DATA_CHARS = len(DATA_URL_PREFIX) + 1


class ThumbnailOut(OutputModel):
    """一张大屏的缩略图。"""

    dashboard_id: uuid.UUID
    data: str
    updated_at: Utc


class ThumbnailPutIn(InputModel):
    """整张替换缩略图。

    ⚠ 这里**不**限上限长度：超限的口径是 413，而 pydantic 的 `max_length`
    回的是 422。体积闸因此在 service 层，见 `thumbnail_service`。
    """

    data: str = Field(min_length=_MIN_DATA_CHARS, pattern=f"^{DATA_URL_PREFIX}")
