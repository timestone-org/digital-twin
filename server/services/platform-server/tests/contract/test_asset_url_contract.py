"""对象键两侧一致：服务端铸键，浏览器拼取回地址，两份必须逐字对齐。

⚠ 这一份漂了**不会有任何一处报错**：服务端把字节放在 `models/<id>/original`，
前端去取 `model/<id>`，拿回 404，而大屏上只是那一块永远转圈。
两边的代码单看都对。

前端那份在 `web/packages/contracts/src/asset.ts`，这里直接读它的源码比对
（同 `test_dashboard_module_catalog.py` 读闭合联合的做法）。
"""

import re
import uuid
from pathlib import Path

import pytest

from platform_server.apps.assets import keys
from platform_server.apps.assets.kinds import ASSET_KINDS
from platform_server.apps.assets.refs import ASSET_REF_PREFIX

ROOT = Path(__file__).resolve().parents[5]
ASSET_TS = ROOT / "web" / "packages" / "contracts" / "src" / "asset.ts"

SAMPLE_ID = uuid.UUID("0192f0aa-0000-7000-8000-000000000001")

# `model: (id) => \`models/${id}/original\`,`
_BUILDER = re.compile(
    r"(?P<kind>[a-z]+):\s*\(id\)\s*=>\s*`(?P<template>[^`]+)`"
)
# `export const ASSET_KINDS = ['model', 'image', 'icon'] as const`
_KINDS = re.compile(r"ASSET_KINDS = \[(?P<body>[^\]]*)\] as const", re.DOTALL)
_MEMBER = re.compile(r"'([^']+)'")
_PREFIX = re.compile(r"ASSET_REF_PREFIX = '(?P<value>[^']+)'")


def frontend_source() -> str:
    """前端那份契约的源码。"""
    return ASSET_TS.read_text(encoding="utf-8")


def frontend_keys() -> dict[str, str]:
    """前端的对象键模板，`${id}` 换成样例 id 后即完整键。"""
    return {
        match.group("kind"): match.group("template").replace(
            "${id}", str(SAMPLE_ID)
        )
        for match in _BUILDER.finditer(frontend_source())
    }


def test_the_frontend_contract_file_is_where_we_think_it_is() -> None:
    # ⚠ 文件挪走时这里要红：否则下面那批会在一个空字符串上全部通过
    assert ASSET_TS.exists()
    assert "assetObjectKey" in frontend_source()


def test_both_sides_know_the_same_kinds() -> None:
    matched = _KINDS.search(frontend_source())
    assert matched is not None
    assert set(_MEMBER.findall(matched.group("body"))) == set(ASSET_KINDS)


def test_both_sides_use_the_same_reference_prefix() -> None:
    matched = _PREFIX.search(frontend_source())
    assert matched is not None
    assert matched.group("value") == ASSET_REF_PREFIX


@pytest.mark.parametrize("kind", ASSET_KINDS)
def test_every_kind_builds_the_same_object_key_on_both_sides(
    kind: str,
) -> None:
    assert frontend_keys()[kind] == keys.object_key(kind, SAMPLE_ID)


def test_the_frontend_covers_every_kind_the_backend_mints() -> None:
    # 前端少一类时，那一类素材在界面上取回的是一条 undefined 拼出来的地址
    assert set(frontend_keys()) == set(ASSET_KINDS)
