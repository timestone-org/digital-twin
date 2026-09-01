"""knowledge-server 进程入口。

容器 `CMD` 直接用 `knowledge-server` 这个可执行名。

⚠ 同一份镜像跑两个角色，由 `KNOWLEDGE_APP_ROLE` 分叉。worker 角色**不起 HTTP**：
它不接流量，「摘掉它」没有意义，能不能干活由队列与日志说话。
"""

import asyncio

import uvicorn

from knowledge_server.app import build_app
from knowledge_server.settings import Settings
from knowledge_server.worker import run_worker
from lib.config import load_settings_or_exit


def main() -> None:
    """构造配置，按角色起 HTTP 服务或摄取循环。"""
    settings = load_settings_or_exit(Settings)
    if settings.is_worker:
        asyncio.run(run_worker(settings))
        return
    uvicorn.run(
        build_app(settings),
        host=settings.app_http_host,
        port=settings.app_http_port,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
