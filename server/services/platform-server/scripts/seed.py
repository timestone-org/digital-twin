"""把出厂预设的库公式写进公式库。可重复执行，跟着 `alembic upgrade` 一起跑。

⚠ 补种子的规则（只补缺、不动开关）在 `services/formula_library.py` 里，
本文件只是它的进程入口：规则留在服务层才进得了测试与覆盖率
（docs/DATASET_DESIGN.md §5.11）。
"""

import asyncio

from lib.config import load_settings_or_exit
from lib.db import Database
from lib.logging import configure_logging, get_logger
from platform_server.apps.dataset.builtin_formulas import BUILTIN_FORMULAS
from platform_server.apps.dataset.services.formula_library import (
    seed_builtin_formulas,
)
from platform_server.settings import Settings

_logger = get_logger("platform.seed")


async def run(settings: Settings) -> None:
    """执行一次种子同步。

    Args: settings。
    """
    database = Database(
        dsn=settings.dsn(), search_path=settings.postgres_schema
    )
    try:
        async with database.session() as session:
            added = await seed_builtin_formulas(session)
        _logger.info(
            "seed_completed",
            "预设公式同步完成",
            presets=len(BUILTIN_FORMULAS),
            added=added,
        )
    finally:
        await database.dispose()


def main() -> None:
    """种子入口。"""
    settings = load_settings_or_exit(Settings)
    configure_logging(
        service=settings.app_name,
        role="seed",
        instance=settings.app_instance,
        level=settings.app_log_level,
        log_format=settings.app_log_format,
    )
    asyncio.run(run(settings))


if __name__ == "__main__":
    main()
