"""对象键、类型闸与素材引用的口径。

⚠ 这三样各自守着一类「不报错但错」的事：键形状漂了会让删素材删不掉字节、
类型闸漏了会让绕过页面的上传得逞、引用形状漂了会让存量大屏静默取不到模型。
"""

import uuid

import pytest

from platform_server.apps.assets import keys, variants
from platform_server.apps.assets.kinds import ASSET_KINDS, kinds, spec_of
from platform_server.apps.assets.refs import asset_ref, parse_asset_ref

ASSET_ID = uuid.UUID("0192f0aa-0000-7000-8000-000000000001")


def test_every_registered_kind_has_a_spec() -> None:
    assert [spec_of(kind) is not None for kind in kinds()] == [True] * len(
        ASSET_KINDS
    )


def test_every_registered_kind_has_an_object_key() -> None:
    # ⚠ 逐类铺满：少一类时这里当场 KeyError，而拼字符串会静默指到不存在的前缀
    built = [keys.object_key(kind, ASSET_ID) for kind in kinds()]
    assert len(set(built)) == len(built)


def test_a_model_lives_under_its_own_prefix() -> None:
    assert keys.model_key(ASSET_ID).startswith(keys.model_prefix(ASSET_ID))


def test_deleting_a_model_targets_the_whole_prefix() -> None:
    # 模型将来会有派生件落在同一前缀下，删的必须是前缀而不是单个键
    assert keys.owned_prefix("model", ASSET_ID) == keys.model_prefix(ASSET_ID)


def test_deleting_a_flat_kind_targets_the_object_itself() -> None:
    assert keys.owned_prefix("image", ASSET_ID) == keys.image_key(ASSET_ID)


def test_the_staging_key_carries_the_kind() -> None:
    # kind 编进键里，finalize 才能从键里读回来而不是从请求体里收第二份
    assert keys.staging_key("model", ASSET_ID) == f"staging/model/{ASSET_ID}"


def test_staging_is_never_publicly_readable() -> None:
    # ⚠ 未验证的字节躺在匿名可读前缀下 = 任何人都能上传任意内容并拿到本站链接
    assert keys.is_public(keys.staging_key("model", ASSET_ID)) is False


@pytest.mark.parametrize("kind", ASSET_KINDS)
def test_every_finalized_kind_is_publicly_readable(kind: str) -> None:
    assert keys.is_public(keys.object_key(kind, ASSET_ID)) is True


def test_a_reference_round_trips() -> None:
    assert parse_asset_ref(asset_ref(ASSET_ID)) == ASSET_ID


def test_a_reference_without_the_prefix_is_rejected() -> None:
    assert parse_asset_ref(str(ASSET_ID)) is None


def test_a_reference_with_a_broken_uuid_is_rejected() -> None:
    assert parse_asset_ref("asset:not-a-uuid") is None


def test_a_url_is_never_mistaken_for_a_reference() -> None:
    # 存 URL 是下一次部署就 404 的写法，解析这一步先把它挡住
    assert parse_asset_ref("https://cdn.example.com/a.glb") is None


def test_a_model_accepts_both_gltf_packagings() -> None:
    spec = spec_of("model")
    assert spec is not None
    # 只认 .glb 会让用户导出的 .gltf 在选文件那一步就被灰掉，且没有任何提示
    assert spec.accepts("model/gltf-binary") is True
    assert spec.accepts("model/gltf+json") is True


def test_a_model_accepts_the_typeless_fallback() -> None:
    spec = spec_of("model")
    assert spec is not None
    # 不少系统对 .glb 给不出类型，浏览器于是填 octet-stream
    assert spec.accepts("application/octet-stream") is True


def test_an_icon_does_not_accept_a_model() -> None:
    spec = spec_of("icon")
    assert spec is not None
    assert spec.accepts("model/gltf-binary") is False


def test_the_icon_budget_is_far_below_the_model_budget() -> None:
    icon = spec_of("icon")
    model = spec_of("model")
    assert icon is not None
    assert model is not None
    assert icon.max_bytes < model.max_bytes


def test_an_unregistered_kind_has_no_spec() -> None:
    assert spec_of("video") is None


@pytest.mark.parametrize(
    ("variant", "expected"),
    [
        ("original", f"models/{ASSET_ID}/original"),
        ("high", f"models/{ASSET_ID}/high"),
        ("medium", f"models/{ASSET_ID}/medium"),
        ("low", f"models/{ASSET_ID}/low"),
    ],
)
def test_every_variant_lands_under_the_model_prefix(
    variant: str, expected: str
) -> None:
    # ⚠ 派生档必须与原件同前缀：删素材删的是整前缀，掉在外面的那一档会变成
    # 没有任何一行指向、也再没人清理的孤儿
    assert keys.model_variant_key(ASSET_ID, variant) == expected


def test_the_original_variant_is_the_plain_model_key() -> None:
    # 「原件」不是第四个派生件，它就是这一类的基准键
    assert keys.model_variant_key(ASSET_ID, "original") == keys.model_key(
        ASSET_ID
    )


def test_deleting_an_asset_sweeps_every_variant() -> None:
    prefix = keys.owned_prefix("model", ASSET_ID)

    for variant in ("original", "high", "medium", "low"):
        assert keys.model_variant_key(ASSET_ID, variant).startswith(prefix)


def test_the_variant_catalog_matches_the_derived_list() -> None:
    # 目录与「要压哪几档」是同一份真源：漂了就会有一档永远排不上队
    assert set(variants.derived()) == {"high", "medium", "low"}
    assert all(
        variants.spec_of(name) is not None for name in variants.derived()
    )
    assert variants.spec_of("original") is None
    assert variants.spec_of("nope") is None


def test_every_known_variant_includes_the_original() -> None:
    assert variants.is_known("original")
    assert not variants.is_known("ultra")
