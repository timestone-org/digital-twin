"""隔离验收应用入口；仅允许专用本地测试库与本地合成模型。"""

from urllib.parse import urlsplit

from fastapi import FastAPI
from pydantic_settings import SettingsConfigDict

from ai_assistant.app import build_app
from ai_assistant.settings import Settings
from lib.config import load_settings


class ValidationSettings(Settings):
    """验收进程只从显式环境读取配置。"""

    model_config = SettingsConfigDict(env_file=None)


def _is_local_http_url(value: str) -> bool:
    """只接受无身份信息且带显式端口的回环 HTTP；Args: value。"""
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        return False
    return (
        parts.scheme == "http"
        and parts.hostname == "127.0.0.1"
        and port is not None
        and 0 < port <= 65535
        and parts.username is None
        and parts.password is None
    )


def build_validation_app() -> FastAPI:
    """仅从显式环境装配隔离应用。"""
    settings = load_settings(ValidationSettings)
    if (
        settings.postgres_host != "127.0.0.1"
        or settings.postgres_db != "dt_ai_validation"
    ):
        raise RuntimeError("验收入口只允许独立本地 dt_ai_validation 数据库")
    if not _is_local_http_url(settings.model_base_url):
        raise RuntimeError("验收入口只允许本地模型仿真")
    return build_app(settings)
