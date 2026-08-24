"""ai-assistant 进程入口。容器 `CMD` 直接用 `ai-assistant` 这个可执行名。"""

import uvicorn

from ai_assistant.app import build_app
from ai_assistant.settings import Settings
from lib.config import load_settings_or_exit


def main() -> None:
    """构造配置与应用并起 HTTP 服务。"""
    settings = load_settings_or_exit(Settings)
    uvicorn.run(
        build_app(settings),
        host=settings.app_http_host,
        port=settings.app_http_port,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
