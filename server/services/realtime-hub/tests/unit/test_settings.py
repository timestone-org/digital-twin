"""配置默认值与上游服务的真实监听口径对齐。"""

from realtime_hub.settings import Settings

# auth-server 的 app_http_port，compose 与 .env.example 都写这个值
AUTH_SERVER_URL = "http://auth-server:8004"


def test_the_default_auth_url_points_at_the_auth_port() -> None:
    assert Settings.model_fields["auth_base_url"].default == AUTH_SERVER_URL
