"""二进制产物与对象存储之间的那一段：取回来、搬过去、缓一份。

`artifact_store` 是纯的（封存、护栏、拼键），本模块是它碰存储的那一半——分开
是因为求值路径要 import 前者却绝不许碰后者
（docs/MODELING_PLATFORM_DESIGN.md D9）。

⚠ 反序列化是**一次同步的 CPU 活**，在事件循环上跑。放进线程池并不能让它让出
GIL，放进进程池又得把结果再序列化一次送回来——那正是要省掉的开销。所以：限死
产物体积把这一次停顿框住，并只在每个进程每个版本上付一次（靠 `ArtifactCache`）。
"""

from collections import OrderedDict
from typing import Any

from lib.logging import get_logger
from lib.objectstore import ObjectNotFound, ObjectStore, ObjectStoreError
from platform_server.apps.modeling.services import artifact_store
from platform_server.apps.modeling.services.artifact_store import (
    ArtifactRejected,
)
from platform_server.apps.modeling.services.jsonshape import as_dict, as_text

_logger = get_logger("platform.modeling.artifact")

# 单份产物的体积上限。⚠ 它框住的是**反序列化那一次停顿**：字节越多，事件循环
# 被占住越久，而那期间这个副本上所有请求一起卡着
MAX_ARTIFACT_BYTES = 32 * 1024 * 1024

# 每个进程缓存几份模型本体。⚠ 一片森林在内存里可以比它的字节数还大，缓太多的
# 表现是副本被 OOM 杀掉重启，而日志里只有一行「容器退出」
_CACHE_CAPACITY = 4


class ArtifactCache:
    """按摘要缓存加载好的模型本体。

    ⚠ 键是**内容摘要**不是版本 id：模型版本本就不可变，按摘要建键让「同一份
    产物被两个版本引用」时只解一次；而万一某个版本的字节真被换过，摘要跟着变，
    缓存自然不会命中旧的那一份。
    """

    def __init__(self, capacity: int = _CACHE_CAPACITY) -> None:
        self._capacity = capacity
        self._items: OrderedDict[str, Any] = OrderedDict()

    def get(self, digest: str) -> Any | None:
        """缓存里那一份；没有给 `None`。

        Args: digest。
        """
        if digest not in self._items:
            return None
        self._items.move_to_end(digest)
        return self._items[digest]

    def put(self, digest: str, estimator: Any) -> None:
        """放一份进去，满了就淘汰最久没用的。

        Args: digest, estimator。
        """
        self._items[digest] = estimator
        self._items.move_to_end(digest)
        while len(self._items) > self._capacity:
            self._items.popitem(last=False)


async def fetch(
    store: ObjectStore, meta: dict[str, Any], cache: ArtifactCache | None = None
) -> Any:
    """把一份产物取回来、过完护栏、反序列化成模型本体。

    ⚠ 失败一律抛 `ArtifactRejected` 并带人话原因：调用点要把它落成「这个版本
    为什么用不了」，而不是一格莫名其妙的空白。
    Args: store, meta, cache。
    """
    digest = as_text(meta.get("digest"))
    cached = None if cache is None else cache.get(digest)
    if cached is not None:
        return cached
    payload = await _read(store, as_text(meta.get("object_key")))
    estimator = artifact_store.load(
        payload,
        digest=digest,
        format_version=_as_int(meta.get("format_version")),
        runtime={
            key: str(value)
            for key, value in as_dict(meta.get("runtime")).items()
        },
    )
    if cache is not None:
        cache.put(digest, estimator)
    return estimator


async def promote(
    store: ObjectStore, meta: dict[str, Any], target_key: str
) -> dict[str, Any]:
    """把运行期那份产物搬到模型版本自己的键下，回一份指向新键的元信息。

    ⚠ 必须**搬一份**而不是让版本指着运行期那个键：运行记录有保留期，到期整片
    删掉之后，指着它的那些模型版本会一起变成算不出数的版本（D9）。
    ⚠ 搬的是存储侧的 copy，字节不进本进程。
    Args: store, meta, target_key。
    """
    source = as_text(meta.get("object_key"))
    try:
        await store.copy(source, target_key)
    except ObjectNotFound as error:
        raise ArtifactRejected(
            "这次运行的模型产物已经不在存储里了，请重跑一遍这条流水线再发布"
        ) from error
    except ObjectStoreError as error:
        raise ArtifactRejected(f"模型产物搬运失败：{error}") from error
    _logger.info(
        "modeling_artifact_promoted",
        "模型产物已归到版本名下",
        source_key=source,
        target_key=target_key,
    )
    return {**meta, "object_key": target_key}


async def _read(store: ObjectStore, key: str) -> bytes:
    """读回字节，顺带把体积卡住。

    Args: store, key。
    """
    if not key:
        raise ArtifactRejected("这个模型版本没有记下产物的位置")
    try:
        payload = await store.get_bytes(key)
    except ObjectNotFound as error:
        raise ArtifactRejected(
            "模型产物已经不在存储里了，请重新训练并发布"
        ) from error
    except ObjectStoreError as error:
        raise ArtifactRejected(f"模型产物读不出来：{error}") from error
    if len(payload) > MAX_ARTIFACT_BYTES:
        raise ArtifactRejected(
            f"模型产物有 {len(payload) // (1024 * 1024)} MB，"
            f"超过 {MAX_ARTIFACT_BYTES // (1024 * 1024)} MB 上限，拒绝加载"
        )
    return payload


def _as_int(value: object) -> int:
    """JSONB 里读回来的整数。不是整数就给 0，让格式那道闸去拒。

    Args: value。
    """
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return value
