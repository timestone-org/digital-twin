"""报告 API 连接目录与模板中的非秘密取数配置。"""

import json
import re
from typing import Annotated, Literal, Self
from urllib.parse import unquote, urlsplit

from pydantic import (
    Field,
    JsonValue,
    SecretStr,
    field_validator,
    model_validator,
)

from collectwire.http import (
    HttpOptions,
    validate_http_endpoint,
    validate_http_pointer,
)
from platform_server.apps.report.schemas.common import Code, InputModel, Label

MAX_COLUMNS = 50
MAX_CONFIG_BYTES = 65_536
MIN_HEADER_CHARACTER = 32
MAX_HEADER_CHARACTER = 126
_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$")
_VARIABLE = re.compile(r"\{\{\s*(period|start|end|timezone)\s*\}\}")


def _pointer(value: str) -> str:
    validate_http_pointer(value or "$")
    if value == "$":
        raise ValueError("JSON Pointer 根值请使用空字符串")
    return value


def _validate_variables(value: JsonValue) -> None:
    if isinstance(value, str):
        plain = _VARIABLE.sub("", value)
        if "{{" in plain or "}}" in plain:
            raise ValueError("API 参数包含不支持的报告期变量")
    elif isinstance(value, dict):
        for child in value.values():
            _validate_variables(child)
    elif isinstance(value, list):
        for child in value:
            _validate_variables(child)


class ReportApiColumn(InputModel):
    """把响应字段映射为报告可用列。"""

    key: Code
    name: Label
    pointer: str = Field(max_length=1024)
    data_type: Literal["number", "text", "boolean"] = "number"

    @field_validator("pointer")
    @classmethod
    def validate_pointer(cls, value: str) -> str:
        return _pointer(value)


class ReportApiConnection(InputModel):
    """只在部署设置中提供的已授权连接与请求头。"""

    code: Code
    name: Label
    base_url: str = Field(max_length=2048)
    headers: dict[str, SecretStr] = Field(default_factory=dict)

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        validate_http_endpoint(value)
        parsed = urlsplit(value)
        if parsed.query or "\\" in value:
            raise ValueError("API 连接地址不能包含查询参数或反斜杠")
        return value.rstrip("/")

    @field_validator("headers")
    @classmethod
    def validate_headers(
        cls, headers: dict[str, SecretStr]
    ) -> dict[str, SecretStr]:
        if len(headers) > MAX_COLUMNS:
            raise ValueError("API 请求头超过数量上限")
        if len({name.casefold() for name in headers}) != len(headers):
            raise ValueError("API 请求头不能重复")
        for name, value in headers.items():
            if not _HEADER_NAME.fullmatch(name) or name.casefold() in {
                "host",
                "content-length",
                "transfer-encoding",
                "cookie",
                "set-cookie",
                "proxy-authorization",
                "connection",
            }:
                raise ValueError("API 请求头名称不合法或覆盖网络路由")
            if any(
                not MIN_HEADER_CHARACTER <= ord(char) <= MAX_HEADER_CHARACTER
                for char in value.get_secret_value()
            ):
                raise ValueError("API 请求头值不合法")
        return headers


class ReportApiSource(InputModel):
    """模板持久化的 API 读取定义，不含凭据。"""

    code: Annotated[Code, Field(max_length=60)]
    name: Label
    connection: Code
    path: str = Field(min_length=1, max_length=2048)
    method: Literal["GET", "POST"] = "GET"
    query: dict[str, str] = Field(default_factory=dict)
    body: dict[str, JsonValue] | None = None
    rows_pointer: str = Field(default="", max_length=1024)
    time_pointer: str | None = Field(default=None, max_length=1024)
    columns: list[ReportApiColumn] = Field(min_length=1, max_length=MAX_COLUMNS)
    offset: int = Field(default=0, ge=-120, le=120)

    @field_validator("path")
    @classmethod
    def validate_path(cls, path: str) -> str:
        decoded = unquote(path)
        if (
            not decoded.startswith("/")
            or decoded.startswith("//")
            or any(char in decoded for char in ("\\", "?", "#", "%"))
            or any(ord(char) <= MIN_HEADER_CHARACTER for char in decoded)
            or any(part in {".", ".."} for part in decoded.split("/"))
            or urlsplit(decoded).netloc
        ):
            raise ValueError("API 路径须为不含跳转、查询参数和片段的相对路径")
        return path

    @field_validator("rows_pointer", "time_pointer")
    @classmethod
    def validate_mapping(cls, value: str | None) -> str | None:
        return _pointer(value) if value is not None else None

    @model_validator(mode="after")
    def validate_request(self) -> Self:
        if len({column.key for column in self.columns}) != len(self.columns):
            raise ValueError("API 映射列编码不能重复")
        options = HttpOptions(
            method=self.method,
            query_json=json.dumps(self.query),
            body_json=json.dumps(self.body) if self.body is not None else None,
        )
        if len(options.model_dump_json().encode()) > MAX_CONFIG_BYTES:
            raise ValueError("API 请求配置超过大小上限")
        for value in self.query.values():
            _validate_variables(value)
        _validate_variables(self.body)
        return self
