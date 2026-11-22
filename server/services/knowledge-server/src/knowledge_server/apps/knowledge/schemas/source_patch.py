"""管理员编辑平台来源时可提交的字段。"""

from typing import Annotated, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from pydantic.json_schema import SkipJsonSchema

from knowledge_server.apps.knowledge.models.source import NAME_MAX_LENGTH


class _SourcePatch(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, json_schema_extra={"minProperties": 1}
    )

    @field_validator("*", mode="before")
    @classmethod
    def _non_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("请提交有效的字段值")
        return value

    @model_validator(mode="after")
    def _non_empty(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("请至少提交一个要修改的字段")
        return self


type _OptionalText = str | SkipJsonSchema[None]


class PlatformSourcePatch(_SourcePatch):
    """平台路径、记录标识、标题及分页参数的部分更新。"""

    path: _OptionalText = Field(default_factory=lambda: None)
    id_field: _OptionalText = Field(default_factory=lambda: None)
    title_field: _OptionalText = Field(default_factory=lambda: None)
    page_param: _OptionalText = Field(default_factory=lambda: None)
    size_param: _OptionalText = Field(default_factory=lambda: None)


class SourceMetadataIn(_SourcePatch):
    """平台来源名称与配置的部分更新。"""

    name: (
        Annotated[
            str,
            StringConstraints(
                strip_whitespace=True, min_length=1, max_length=NAME_MAX_LENGTH
            ),
        ]
        | SkipJsonSchema[None]
    ) = Field(default_factory=lambda: None)
    config: PlatformSourcePatch | SkipJsonSchema[None] = Field(
        default_factory=lambda: None
    )
