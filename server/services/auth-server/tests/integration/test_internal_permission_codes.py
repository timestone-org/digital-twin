"""内部端点「权限码全集」的集成用例。

⚠ 它是 realtime-hub 登记主题时校验声明的码的**唯一来源**
（ADR-0007 §决策 4）。这里守两件事：

1. 服务级密钥挡得住无凭证调用——它在 `/internal/` 下，边缘对该前缀一律 deny，
   但绕过边缘直连端口时只剩这道密钥。
2. 返回的码与 `catalog.py` 逐字一致。两边一旦漂了，表现是 hub 拒掉本来合法
   的登记，而报错落在**另一个服务**的日志里，从现象追不回这个端点。
"""

import httpx
import pytest

from auth_server.apps.auth import catalog
from auth_server.settings import INTERNAL_PREFIX

pytestmark = pytest.mark.requires_postgres

CODES = f"{INTERNAL_PREFIX}/permission-codes"


async def test_returns_exactly_the_catalog_codes(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(CODES)
    assert response.status_code == 200
    payload = response.json()["data"]
    assert set(payload["codes"]) == catalog.ALL_CODES


async def test_codes_are_sorted_so_the_response_is_stable(
    app_client: httpx.AsyncClient,
) -> None:
    # 调用方会缓存这份清单；顺序抖动会让「有没有变」这个判断失效
    response = await app_client.get(CODES)
    codes = response.json()["data"]["codes"]
    assert codes == sorted(codes)


async def test_requires_the_service_key(
    app_client: httpx.AsyncClient,
) -> None:
    without_key = await app_client.get(CODES, headers={"X-Service-Key": ""})
    wrong_key = await app_client.get(CODES, headers={"X-Service-Key": "wrong"})
    assert without_key.status_code == 401
    assert wrong_key.status_code == 401


async def test_realtime_declares_no_code_of_its_own(
    app_client: httpx.AsyncClient,
) -> None:
    """⚠ hub 校验的是别的域的码，它自己不该往目录里塞码（见 #35）。"""
    response = await app_client.get(CODES)
    codes = response.json()["data"]["codes"]
    assert not [code for code in codes if code.startswith("realtime:")]
