"""来源配置与界面描述遵守同一套关闭对象的校验。"""

from collections.abc import Mapping
from typing import cast

import httpx
import pytest

from knowledge_server.apps.knowledge.schemas.source_config import (
    PlatformSourceConfig,
    UploadSourceConfig,
    validate_source_config,
)
from knowledge_server.apps.knowledge.services.sources import (
    PlatformSource,
    UploadSource,
)
from lib.errors import ValidationFailed
from lib.objectstore import ObjectStore


@pytest.mark.parametrize(
    ("kind", "config"),
    [
        ("upload", {}),
        ("platform", {"path": "/api/v1/platform/dataset-tables"}),
        (
            "platform",
            {
                "path": "/x",
                "id_field": "",
                "title_field": "中文名称",
                "page_param": "页码",
                "size_param": "每页",
            },
        ),
    ],
)
def test_valid_configurations_preserve_supported_source_choices(
    kind: str, config: dict[str, object]
) -> None:
    validate_source_config(kind, config)
    models = {"platform": PlatformSourceConfig, "upload": UploadSourceConfig}
    assert (
        models[kind].model_validate(config).model_dump(exclude_unset=True)
        == config
    )


@pytest.mark.parametrize(
    ("kind", "config"),
    [
        ("not-installed", {}),
        ("upload", {"key": "unknown"}),
        ("platform", {}),
        ("platform", {"path": 1}),
        ("platform", {"path": ""}),
        ("platform", {"path": "http://127.0.0.1/"}),
        ("platform", {"path": "//169.254.169.254/latest/meta-data"}),
        ("platform", {"path": "/x", "id_field": None}),
        ("platform", {"path": "/x", "size_param": 50}),
        ("platform", {"path": "/x", "ignored_typo": "true"}),
    ],
)
def test_invalid_configs_produce_the_public_validation_error(
    kind: str, config: dict[str, object]
) -> None:
    with pytest.raises(ValidationFailed) as caught:
        validate_source_config(kind, config)
    assert caught.value.http_status == 400
    assert caught.value.is_retryable is False


async def test_platform_schema_matches_validation_properties() -> None:
    async with httpx.AsyncClient(base_url="http://unused") as client:
        advertised = PlatformSource(client, {}).config_schema()
    validated = PlatformSourceConfig.model_json_schema()
    properties = cast(
        Mapping[str, Mapping[str, object]], advertised["properties"]
    )
    assert set(properties) == set(validated["properties"])
    assert (
        advertised["additionalProperties"]
        is validated["additionalProperties"]
        is False
    )
    assert advertised["required"] == validated["required"] == ["path"]
    assert (
        properties["path"]["pattern"]
        == validated["properties"]["path"]["pattern"]
        == "^/(?!/)"
    )


def test_upload_schema_rejects_unknown_fields() -> None:
    # 配置描述不访问对象存储。
    advertised = UploadSource(cast(ObjectStore, None)).config_schema()
    validated = UploadSourceConfig.model_json_schema()
    assert advertised["properties"] == validated["properties"] == {}
    assert (
        advertised["additionalProperties"]
        is validated["additionalProperties"]
        is False
    )
