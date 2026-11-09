"""贴进来的图按认出的格式重新标 media type，不沿用调用方声明的那一个。

守的是「判的是字节、发的是声明」：`data:image/gif;base64,<png>` 过得了白名单，
原样转给视觉端点时严格的供应商按 400 拒，整轮失败。
"""

import base64

from ai_assistant.apps.chat.api import advance as advance_api
from ai_assistant.apps.chat.schemas.advance import AdvanceIn

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode("ascii")


def _checked(*uris: str) -> list[str]:
    payload = AdvanceIn(
        surface_kind="dashboard-editor", user_text="看图", user_images=[*uris]
    )
    return advance_api._checked_images(  # pyright: ignore[reportPrivateUsage]
        payload
    )


def test_a_mislabelled_picture_goes_out_with_its_real_type() -> None:
    assert _checked(f"data:image/gif;base64,{PNG}") == [
        f"data:image/png;base64,{PNG}"
    ]


def test_a_correctly_labelled_picture_is_untouched() -> None:
    uri = f"data:image/png;base64,{PNG}"
    assert _checked(uri) == [uri]


def test_the_checked_images_are_what_the_turn_receives() -> None:
    payload = AdvanceIn(
        surface_kind="dashboard-editor",
        user_text="看图",
        user_images=[f"data:text/html;base64,{PNG}"],
    )
    got = advance_api._to_input(  # pyright: ignore[reportPrivateUsage]
        payload,
        advance_api._checked_images(  # pyright: ignore[reportPrivateUsage]
            payload
        ),
    )
    assert got.user_images == [f"data:image/png;base64,{PNG}"]
