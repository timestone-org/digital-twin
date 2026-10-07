"""来源配置在写入 JSONB 之前的形状与路径校验。"""

from collections.abc import Mapping
from typing import Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
)

from lib.errors import ValidationFailed


class PlatformSourceConfig(BaseModel):
    """平台来源只接受路径和字符串分页、显示字段配置。"""

    model_config = ConfigDict(extra="forbid", strict=True)

    path: str = Field(min_length=1, json_schema_extra={"pattern": "^/(?!/)"})
    id_field: str = "row_id"
    title_field: str = ""
    page_param: str = "page"
    size_param: str = "size"

    @field_validator("path")
    @classmethod
    def validate_path(cls, given: str) -> str:
        """拒绝完整 URL 与非路径。Args: given。"""
        if not given.startswith("/") or given.startswith("//"):
            raise ValueError("来源只接受平台路径")
        return given


class UploadSourceConfig(BaseModel):
    """上传来源没有用户可配置字段。"""

    model_config = ConfigDict(extra="forbid", strict=True)


def validate_source_config(kind: str, config: Mapping[str, Any]) -> None:
    """拒绝没有接入的来源或无效配置，不让数据库 CHECK 代为报错。

    Args: kind, config。
    """
    models = {"platform": PlatformSourceConfig, "upload": UploadSourceConfig}
    model = models.get(kind)
    if model is None:
        raise ValidationFailed("这套部署没有接入这一路知识来源")
    try:
        model.model_validate(dict(config))
    except ValidationError as error:
        raise ValidationFailed(
            "知识来源配置无效，请检查平台路径与字段配置"
        ) from error
