"""collector-server 进程入口。容器 `CMD` 直接用这个可执行名。

⚠ 起的是 uvicorn，但**没有业务路由**：HTTP 只服务探针，采集跑在 lifespan
里的后台任务上（见 app.py）。
"""

import uvicorn

from collector_server.app import build_app
from collector_server.settings import Settings
from lib.config import load_settings_or_exit


def main() -> None:
    """构造配置与应用并起探针服务。"""
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
