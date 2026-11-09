"""模型版本字节的事后清理：版本行没了或没落成，对象存储里的那份跟着删。"""

from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import after_commit
from lib.logging import get_logger
from lib.objectstore import ObjectStore, ObjectStoreError

_logger = get_logger("platform.modeling.artifact_cleanup")


def discard_after_commit(
    session: AsyncSession, store: ObjectStore | None, key: str
) -> None:
    """登记「本次事务提交后删掉这个键」；没配对象存储或键为空时什么都不做。

    ⚠ 只在提交后删：回滚的话版本行还在，字节先删了就成了指着空键的版本。
    Args: session, store, key。
    """
    if store is None or not key:
        return

    async def _discard() -> None:
        """删掉那个键；对象存储报错只记一条告警，版本行已经落定。"""
        try:
            await store.delete_prefix(key)
        except ObjectStoreError as error:
            _logger.warning(
                "modeling_model_bytes_cleanup_failed",
                "模型版本字节清理失败",
                object_key=key,
                error=error,
            )

    after_commit(session, _discard)
