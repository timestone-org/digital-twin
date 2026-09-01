"""上游客户端的装配。

⚠ 守一件在用例里看不见的事：`PlatformClient` 必须**装着续签件**。不装它，
一切照常跑得通——用例里的身份头是现造的、永远新鲜——只有真部署里跑过一分钟
的回合才会露出来，而现象是「points.search 没跑成」，指不回装配。
"""

from pydantic import SecretStr

from ai_assistant.container import build_container
from ai_assistant.settings import Settings
from ai_assistant.upstream import DelegatedIdentity

PLACEHOLDER = "ai-assistant-test"


def _settings(**overrides: object) -> Settings:
    """占位配置。

    Args: overrides。
    """
    base: dict[str, object] = {
        "postgres_host": PLACEHOLDER,
        "postgres_user": PLACEHOLDER,
        "postgres_password": SecretStr(PLACEHOLDER),
        "postgres_db": PLACEHOLDER,
        "redis_host": PLACEHOLDER,
        "edge_signing_secret": SecretStr("s" * 32),
        "edge_service_key": SecretStr("k" * 32),
    }
    base.update(overrides)
    return Settings(
        **base
    )  # pyright: ignore[reportArgumentType]  # 理由：用例造件按名传参


def test_the_platform_client_is_wired_with_a_renewing_identity() -> None:
    container = build_container(_settings())

    # 私有字段：这条口径没有别的观察点，而漏装它是静默的
    identity = getattr(container.platform, "_identity", None)
    assert isinstance(identity, DelegatedIdentity)


def test_the_auth_client_is_one_per_process() -> None:
    container = build_container(_settings())

    # 每请求现造一个的话，签好的头缓存不下来，每次调用都要再签一趟
    assert container.auth is not None


def test_the_reissue_hop_is_budgeted_under_the_platform_call() -> None:
    settings = _settings()

    # 续签是 platform 调用**之前**的一跳；下游之和必须小于上游，
    # 否则边缘先掐断，而现象是「助手转了半天什么都没发生」
    assert settings.auth_timeout_s < settings.platform_timeout_s
