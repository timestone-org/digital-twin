"""解析上传的参考文件。

⚠ 走 base64 而不是 multipart：本仓一个 multipart 端点都没有（素材的字节是直传
对象存储的），引 `python-multipart` 就是为一个端点多一个依赖。

守两条分得开的失败：**解码失败**（调用方没按 base64 传）与**格式不认得**
（文件本身不对）——两者的下一步动作完全不同。
"""

import base64

import httpx
import pytest

pytestmark = pytest.mark.requires_postgres

PARSE_URL = "/api/v1/assistant/attachments:parse"


def _body(filename: str, raw: bytes) -> dict[str, str]:
    return {
        "filename": filename,
        "content_base64": base64.b64encode(raw).decode(),
    }


async def test_a_csv_comes_back_as_a_table(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.post(
        PARSE_URL, json=_body("点表.csv", "code,name\na,出口温度\n".encode())
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert "code | name" in data["text"]
    # 概况由服务端跟正文一起算：界面另算一份的话，两边口径会漂
    assert data["summary"] == "2 列 × 1 行"


async def test_the_flattened_text_is_pipe_separated(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.post(
        PARSE_URL, json=_body("点表.csv", b"code,name\na,b\n")
    )
    assert "code | name" in response.json()["data"]["text"]


async def test_a_plain_text_file_comes_back_verbatim(
    db_client: httpx.AsyncClient,
) -> None:
    # 不一定是点表：纯文本资料也收，正文只走 text 一格
    response = await db_client.post(
        PARSE_URL, json=_body("巡检记录.txt", "1 号机组一切正常".encode())
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["text"] == "1 号机组一切正常"
    assert data["summary"] == "1 行"


async def test_content_that_is_not_base64_is_refused(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.post(
        PARSE_URL,
        json={"filename": "点表.csv", "content_base64": "不是 base64"},
    )
    assert response.status_code == 400
    assert "base64" in response.json()["message"]


async def test_an_unknown_suffix_is_refused_with_what_is_accepted(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.post(
        PARSE_URL, json=_body("点表.pdf", b"%PDF-1.4")
    )
    assert response.status_code == 400
    # 说清认得什么，用户才知道该转成什么再传
    assert ".csv" in response.json()["message"]


async def test_a_caller_without_the_code_is_refused(
    db_client: httpx.AsyncClient, sign: object
) -> None:
    make = sign
    assert callable(make)
    response = await db_client.post(
        PARSE_URL,
        json=_body("点表.csv", b"code\na\n"),
        headers=make(["dashboard:view"]),
    )
    assert response.status_code == 403


async def test_an_image_is_turned_away_from_this_endpoint(
    db_client: httpx.AsyncClient,
) -> None:
    # 图随消息走，不上这条端点——静默回一段空文本的话，用户会以为附上了，
    # 而助手一个字都没收到
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 32
    response = await db_client.post(PARSE_URL, json=_body("现场.png", png))
    assert response.status_code == 400
    assert "图片" in response.json()["message"]
