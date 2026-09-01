"""配置校验：开了档就必须配全，缺一格即拒绝启动。"""

import pytest
from pydantic import SecretStr

from knowledge_server.settings import (
    ROLE_WORKER,
    MigrationSettings,
    Settings,
)

PLACEHOLDER = "knowledge-test"


def _base() -> dict[str, object]:
    return {
        "postgres_host": PLACEHOLDER,
        "postgres_user": PLACEHOLDER,
        "postgres_password": SecretStr(PLACEHOLDER),
        "postgres_db": PLACEHOLDER,
        "redis_host": PLACEHOLDER,
        "objectstore_endpoint": "http://knowledge-test:9000",
        "objectstore_bucket": PLACEHOLDER,
        "objectstore_access_key": SecretStr(PLACEHOLDER),
        "objectstore_secret_key": SecretStr("s" * 16),
        "edge_signing_secret": SecretStr("s" * 32),
        "edge_service_key": SecretStr("k" * 32),
    }


def test_defaults_leave_both_model_paths_off() -> None:
    settings = Settings(**_base())  # pyright: ignore[reportArgumentType]
    assert settings.embedding_enabled is False
    assert settings.model_enabled is False
    assert settings.app_http_port == 8009
    assert settings.postgres_schema == "knowledge"


def test_embedding_enabled_without_key_is_rejected() -> None:
    with pytest.raises(ValueError, match="KNOWLEDGE_EMBEDDING_API_KEY"):
        Settings(  # pyright: ignore[reportArgumentType]
            **_base(),
            embedding_enabled=True,
            embedding_base_url="http://embed",
            embedding_model="text-embedding",
        )


def test_embedding_enabled_without_model_is_rejected() -> None:
    with pytest.raises(ValueError, match="KNOWLEDGE_EMBEDDING_MODEL"):
        Settings(  # pyright: ignore[reportArgumentType]
            **_base(),
            embedding_enabled=True,
            embedding_base_url="http://embed",
            embedding_api_key=SecretStr("key"),
        )


def test_embedding_enabled_with_everything_is_accepted() -> None:
    settings = Settings(  # pyright: ignore[reportArgumentType]
        **_base(),
        embedding_enabled=True,
        embedding_base_url="http://embed",
        embedding_model="text-embedding",
        embedding_api_key=SecretStr("key"),
    )
    assert settings.embedding_enabled is True


def test_model_enabled_without_key_is_rejected() -> None:
    with pytest.raises(ValueError, match="KNOWLEDGE_MODEL_API_KEY"):
        Settings(  # pyright: ignore[reportArgumentType]
            **_base(),
            model_enabled=True,
            model_base_url="http://chat",
            model_chat="qwen",
        )


def test_model_and_embedding_are_judged_apart() -> None:
    """只做混合检索不做 agentic 时，对话档整个用不上——不该被嵌入档拖下水。"""
    settings = Settings(  # pyright: ignore[reportArgumentType]
        **_base(),
        embedding_enabled=True,
        embedding_base_url="http://embed",
        embedding_model="text-embedding",
        embedding_api_key=SecretStr("key"),
    )
    assert settings.model_enabled is False


def test_worker_role_is_recognised() -> None:
    settings = Settings(  # pyright: ignore[reportArgumentType]
        **_base(), app_role=ROLE_WORKER
    )
    assert settings.is_worker is True


def test_migration_settings_need_only_the_database() -> None:
    """⚠ 迁移不该依赖整份配置：只配了库的场合（CI 的迁移作业、部署时先建表）
    会以「Field required」失败，而报出来的字段与建表这件事完全对不上号。"""
    settings = MigrationSettings(
        postgres_host=PLACEHOLDER,
        postgres_user=PLACEHOLDER,
        postgres_password=SecretStr(PLACEHOLDER),
        postgres_db=PLACEHOLDER,
    )
    assert settings.postgres_schema == "knowledge"
