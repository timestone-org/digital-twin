"""缩略图的体积闸与形态闸。

⚠ 体积超限必须是 413 而不是 422：客户端要据此**改小截图重发**，而 422 的语义
是「字段写错了」，客户端只会把同一张图再发一遍。
"""

import pytest
from pydantic import ValidationError

from platform_server.apps.dashboard.errors import ThumbnailTooLarge
from platform_server.apps.dashboard.models.thumbnail import (
    MAX_THUMBNAIL_CHARS,
)
from platform_server.apps.dashboard.schemas.thumbnail import (
    DATA_URL_PREFIX,
    ThumbnailPutIn,
)
from platform_server.apps.dashboard.services.thumbnail_service import (
    require_within_limit,
)

SAMPLE = f"{DATA_URL_PREFIX}png;base64,AAAA"


def data_url_of(total_chars: int) -> str:
    """造一个总长恰为 `total_chars` 的 data URL。

    Args: total_chars。
    """
    return DATA_URL_PREFIX + "A" * (total_chars - len(DATA_URL_PREFIX))


def test_a_thumbnail_at_the_limit_is_accepted() -> None:
    exact = data_url_of(MAX_THUMBNAIL_CHARS)
    require_within_limit(exact)
    assert ThumbnailPutIn(data=exact).data == exact


def test_a_thumbnail_one_character_over_the_limit_is_refused() -> None:
    with pytest.raises(ThumbnailTooLarge):
        require_within_limit(data_url_of(MAX_THUMBNAIL_CHARS + 1))


def test_the_refusal_maps_to_payload_too_large() -> None:
    assert ThumbnailTooLarge.http_status == 413


def test_a_data_url_is_accepted() -> None:
    assert ThumbnailPutIn(data=SAMPLE).data == SAMPLE


def test_a_remote_address_is_refused() -> None:
    # ⚠ 放行 http(s) 等于让一张屏的封面去打第三方地址，而页面上看不出来
    with pytest.raises(ValidationError):
        ThumbnailPutIn(data="https://example.invalid/shot.png")


def test_a_non_image_data_url_is_refused() -> None:
    with pytest.raises(ValidationError):
        ThumbnailPutIn(data="data:text/html;base64,AAAA")


def test_an_empty_payload_is_refused() -> None:
    with pytest.raises(ValidationError):
        ThumbnailPutIn(data="")


def test_an_unknown_field_is_refused() -> None:
    with pytest.raises(ValidationError):
        ThumbnailPutIn.model_validate({"data": SAMPLE, "width": 320})
