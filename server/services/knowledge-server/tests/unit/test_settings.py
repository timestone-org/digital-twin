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


def test_no_embedding_endpoint_when_the_switch_is_off() -> None:
    """⚠ 没接时给 `None` 而不是一个「将来大概会用」的端点：给了的话，库上会
    写着一路根本没算过的模型名，而检索会以为它已经建过索引。"""
    settings = Settings(**_base())  # pyright: ignore[reportArgumentType]
    assert settings.embedding_endpoint() is None
    assert settings.chat_endpoint() is None


def test_the_embedding_endpoint_carries_its_dimensions() -> None:
    """⚠ 维数跟着端点走：`vector(N)` 的 N 是建表时定死的，对不上时 pgvector
    回的是「expected N dimensions」，而那条错不会提到「你改过配置」。"""
    settings = Settings(  # pyright: ignore[reportArgumentType]
        **_base(),
        embedding_enabled=True,
        embedding_base_url="http://embed/v1",
        embedding_model="text-embedding",
        embedding_api_key=SecretStr("key"),
        embedding_dimensions=1024,
    )
    made = settings.embedding_endpoint()
    assert made is not None
    assert made.dimensions == 1024
    assert made.model == "text-embedding"


def test_the_chat_endpoint_only_appears_when_wired() -> None:
    """⚠ 它只决定 agentic 策略可不可用；没接时那个策略**如实不可用**，
    不悄悄退化成 naive。"""
    settings = Settings(  # pyright: ignore[reportArgumentType]
        **_base(),
        model_enabled=True,
        model_base_url="http://chat/v1",
        model_chat="qwen",
        model_api_key=SecretStr("key"),
    )
    made = settings.chat_endpoint()
    assert made is not None
    assert made.model == "qwen"


def test_the_two_lanes_are_independent() -> None:
    """只做混合检索不做 agentic 时，对话档整个用不上——不该被嵌入档拖下水。"""
    settings = Settings(  # pyright: ignore[reportArgumentType]
        **_base(),
        embedding_enabled=True,
        embedding_base_url="http://embed/v1",
        embedding_model="text-embedding",
        embedding_api_key=SecretStr("key"),
    )
    assert settings.embedding_endpoint() is not None
    assert settings.chat_endpoint() is None


def test_mineru_on_without_an_address_refuses_to_start() -> None:
    """⚠ 不打 WARN 继续：留到第一份 PDF 才发现的话，用户看到的是这份文档
    解析失败，而 `/capabilities` 说的是「接了 mineru」。"""
    with pytest.raises(ValueError, match="KNOWLEDGE_MINERU_BASE_URL"):
        Settings(  # pyright: ignore[reportArgumentType]
            **_base(), mineru_enabled=True
        )


def test_mineru_address_must_carry_a_scheme() -> None:
    """⚠ 少了 `http://` 的地址在 httpx 那边是一句 `Request URL is missing
    an 'http://'`，而它发生在**第一次解析**时，不在启动时。"""
    with pytest.raises(ValueError, match="http://"):
        Settings(  # pyright: ignore[reportArgumentType]
            **_base(), mineru_enabled=True, mineru_base_url="mineru:8000"
        )


def test_mineru_off_by_default_and_configurable() -> None:
    settings = Settings(  # pyright: ignore[reportArgumentType]
        **_base(),
        mineru_enabled=True,
        mineru_base_url="http://mineru:8000",
    )
    assert settings.mineru_base_url == "http://mineru:8000"
    assert settings.mineru_lang == "ch"
    assert (
        Settings(**_base()).mineru_enabled is False
    )  # pyright: ignore[reportArgumentType]
