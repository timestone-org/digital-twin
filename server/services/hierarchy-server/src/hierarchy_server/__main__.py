"""层级图服务进程入口。"""

import uvicorn

from hierarchy_server.app import build_app
from hierarchy_server.settings import Settings
from lib.config import load_settings_or_exit


def main() -> None:
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
