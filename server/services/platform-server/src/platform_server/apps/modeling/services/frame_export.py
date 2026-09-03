"""把一次运行里某个端口的**全量帧**写成 CSV，以及把它取回来交给下载。

摘要那一份有硬上限（200 行）——它是给人看一眼的，不是数据。想把处理好的数据
拿走是另一件事，且要另一个权限码（docs/MODELING_PLATFORM_DESIGN.md D12）。

⚠ 这些 CSV 里含**台账原始数据**，所以下载要 `dataset:record:export`，
不是 `modeling:view` 就够。
⚠ 默认不写：运行参数上那一档默认关。默认开会让每一次运行都往对象存储写几十
MB，而绝大多数运行只是在调参数。
⚠ 与运行记录同一个保留期：清理那一趟按 `modeling/runs/{run_id}/` 整片删，
CSV 与二进制产物都在那个前缀底下。
"""

import csv
import io
import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.objectstore import ObjectNotFound, ObjectStore, ObjectStoreError
from platform_server.apps.modeling.crud import node_run_crud
from platform_server.apps.modeling.errors import (
    FrameExportMissing,
    NodeRunNotFound,
)
from platform_server.apps.modeling.operators import Frame
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_text,
)

_logger = get_logger("platform.modeling.export")

# CSV 的内容类型
CONTENT_TYPE = "text/csv; charset=utf-8"

# 一份 CSV 最多写多少行。⚠ 必须封顶：一次取数可以是几十万行，而这一步跑在
# 节点边界上、写进对象存储之前整个在内存里
MAX_EXPORT_ROWS = 200_000

# 时刻那一列在 CSV 里的表头。⚠ 与任何一个真实列 key 都不会撞：帧的列 key 来自
# 台账列名，而这个名字里有下划线包起来的保留形状
INDEX_HEADER = "__ts__"


@dataclass(frozen=True)
class ExportedFrame:
    """写出去的一份 CSV。"""

    object_key: str
    row_count: int
    size_bytes: int
    is_truncated: bool


def frame_key(run_id: str, node_id: str, port: str) -> str:
    """一次运行里某个节点某个端口的 CSV 键。

    ⚠ 键由服务端拼，请求里的任何字符串都不进来。
    Args: run_id, node_id, port。
    """
    return f"modeling/runs/{run_id}/frames/{node_id}.{port}.csv"


def to_csv(frame: Frame) -> tuple[bytes, int, bool]:
    """把一张帧写成 CSV 字节，回 (字节, 行数, 是否被截断)。

    ⚠ 带索引的帧要把时刻写成**第一列**：不写的话，导出来的数据没法与台账对上，
    而那正是导出的用处。
    Args: frame。
    """
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    has_index = frame.index is not None
    head = [INDEX_HEADER] if has_index else []
    writer.writerow(head + [item.key for item in frame.columns])
    kept = min(frame.row_count, MAX_EXPORT_ROWS)
    for position in range(kept):
        stamp = frame.index[position] if frame.index is not None else None
        writer.writerow(
            ([stamp] if has_index else []) + list(frame.rows[position])
        )
    return (
        buffer.getvalue().encode("utf-8"),
        kept,
        frame.row_count > MAX_EXPORT_ROWS,
    )


async def write_frame(
    store: ObjectStore, key: str, frame: Frame
) -> ExportedFrame:
    """把一张帧写进对象存储。

    Args: store, key, frame。
    """
    payload, kept, is_truncated = to_csv(frame)
    await store.put_bytes(key, payload, content_type=CONTENT_TYPE)
    return ExportedFrame(
        object_key=key,
        row_count=kept,
        size_bytes=len(payload),
        is_truncated=is_truncated,
    )


async def write_all(
    store: ObjectStore | None,
    run_id: str,
    node_id: str,
    frames: dict[str, Frame],
) -> dict[str, dict[str, object]]:
    """把一个节点每个输出端口的帧都写出去，回按端口建键的元信息。

    ⚠ 写不进去只记一条日志、**不让这个节点失败**：全量产物是附加品，
    为它把一次跑通的训练判成失败是本末倒置。
    Args: store, run_id, node_id, frames。
    """
    if store is None or not frames:
        return {}
    written: dict[str, dict[str, object]] = {}
    for port, frame in sorted(frames.items()):
        try:
            done = await write_frame(
                store, frame_key(run_id, node_id, port), frame
            )
        except ObjectStoreError as error:
            _logger.warning(
                "modeling_frame_export_failed",
                "全量结果没写进对象存储",
                run_id=run_id,
                node_id=node_id,
                error=error,
            )
            continue
        written[port] = {
            "object_key": done.object_key,
            "row_count": done.row_count,
            "size_bytes": done.size_bytes,
            "is_truncated": done.is_truncated,
        }
    return written


@dataclass(frozen=True)
class Download:
    """一份可以直接交给浏览器的 CSV。"""

    filename: str
    payload: bytes


async def fetch(
    session: AsyncSession, store: ObjectStore | None, wanted: "Wanted"
) -> Download:
    """把某个端口那份 CSV 取回来。

    ⚠ 字节**走服务端转发**，不发预签名 URL：SigV4 把 Host 也签进去，而边缘那条
    `/oss/` location 会把 Host 换成站点自己的域名，签出来的链接到了存储端一律
    验签失败。转发多一跳，但它是这个部署形态下唯一走得通的做法（偏离 D12 的
    「短时预签名 URL」，理由就在这里）。
    Args: session, store, wanted。
    """
    row = await node_run_crud.get_node(
        session, run_id=wanted.run_id, node_id=wanted.node_id
    )
    if row is None:
        raise NodeRunNotFound("这个节点在这次运行里没有记录")
    found = as_dict((row.frames_json or {}).get(wanted.port))
    if not found:
        raise FrameExportMissing(
            "这次运行没有留下这个端口的全量结果——"
            "发起运行时要勾上「保留全量结果」"
        )
    if store is None:
        raise FrameExportMissing("本部署没有配对象存储，取不到全量结果")
    try:
        payload = await store.get_bytes(as_text(found.get("object_key")))
    except ObjectNotFound as error:
        raise FrameExportMissing(
            "全量结果已经过了保留期被清掉了，请重跑一遍"
        ) from error
    return Download(
        filename=f"{wanted.node_id}.{wanted.port}.csv", payload=payload
    )


@dataclass(frozen=True)
class Wanted:
    """要取哪一份。打成一包是因为形参上限是 5。"""

    run_id: uuid.UUID
    node_id: str
    port: str
