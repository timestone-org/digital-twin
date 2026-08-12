"""platform-server 进程入口。容器 `CMD` 直接用这个可执行名。"""

import uvicorn

from lib.config import load_settings_or_exit
from platform_server import worker
from platform_server.app import build_app
from platform_server.settings import ROLE_WORKER, Settings


def main() -> None:
    """按运行角色起对应的进程。

    ⚠ 这是**部署轴**的分叉不是环境轴的：同一份镜像按 `APP_ROLE` 跑出 api 与
    worker 两种进程（ARCHITECTURE §3.4）。API 角色永不跑重任务，HTTP 只负责
    入队与查进度。
    """
    settings = load_settings_or_exit(Settings)
    if settings.app_role == ROLE_WORKER:
        worker.run(settings)
        return
    serve_http(settings)


def serve_http(settings: Settings) -> None:
    """api 角色：起 uvicorn。

    Args: settings。
    """
    uvicorn.run(
        build_app(settings),
        host=settings.app_http_host,
        port=settings.app_http_port,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
