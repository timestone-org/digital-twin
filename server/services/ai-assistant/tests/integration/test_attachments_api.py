"""解析上传的点表。

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
    assert data["columns"] == ["code", "name"]
    assert data["rows"] == [["a", "出口温度"]]


async def test_the_flattened_text_is_pipe_separated(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.post(
        PARSE_URL, json=_body("点表.csv", b"code,name\na,b\n")
    )
    assert "code | name" in response.json()["data"]["text"]


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
