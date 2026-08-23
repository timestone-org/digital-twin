"""台账面用例共用的 URL、请求体与建资源的捷径。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy import text

from lib.db import Database
from timeseries import HISTORY_SCHEMA, HISTORY_TABLE

TABLES = "/api/v1/platform/dataset-tables"
# 台账报脏的跨进程契约键，见 docs/DATASET_DESIGN.md §16
DIRTY_KEY = "platform:dataset:dirty"

HTTP_OK = 200
HTTP_CREATED = 201
HTTP_NO_CONTENT = 204
HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409


def data_of(response: httpx.Response) -> Any:
    """取信封里的 data。"""
    return response.json()["data"]


def code_of(response: httpx.Response) -> int:
    """取信封里的错误码。"""
    return int(response.json()["code"])


def columns_url(table_id: str) -> str:
    """一张台账的列集合地址。"""
    return f"{TABLES}/{table_id}/columns"


def records_url(table_id: str) -> str:
    """一张台账的数据行集合地址。"""
    return f"{TABLES}/{table_id}/records"


def record_url(table_id: str, row_id: str, ts: str | None = None) -> str:
    """一行的地址。带上 `ts` 直接命中分区。"""
    tail = "" if ts is None else f"?ts={ts}"
    return f"{records_url(table_id)}/{row_id}{tail}"


def overrides_url(table_id: str, row_id: str, ts: str | None = None) -> str:
    """一行的人工修正地址。"""
    tail = "" if ts is None else f"?ts={ts}"
    return f"{records_url(table_id)}/{row_id}/overrides{tail}"


def table_body(**overrides: Any) -> dict[str, Any]:
    """一张最小可用的台账。"""
    body: dict[str, Any] = {"code": "shift_output", "name": "班次产量"}
    body.update(overrides)
    return body


def column_body(**overrides: Any) -> dict[str, Any]:
    """一列最小可用的人工录入列。"""
    body: dict[str, Any] = {"key": "产量", "name": "产量"}
    body.update(overrides)
    return body


async def create_table(
    client: httpx.AsyncClient, **overrides: Any
) -> dict[str, Any]:
    """建一张台账并回它的出参。"""
    response = await client.post(TABLES, json=table_body(**overrides))
    assert response.status_code == HTTP_CREATED, response.text
    return data_of(response)


async def create_column(
    client: httpx.AsyncClient, table_id: str, **overrides: Any
) -> dict[str, Any]:
    """给一张台账加一列并回它的出参。"""
    response = await client.post(
        columns_url(table_id), json=column_body(**overrides)
    )
    assert response.status_code == HTTP_CREATED, response.text
    return data_of(response)


async def create_record(
    client: httpx.AsyncClient, table_id: str, **body: Any
) -> dict[str, Any]:
    """录入一行并回它的出参（含 `has_stale_downstream`）。"""
    response = await client.post(records_url(table_id), json=body)
    assert response.status_code == HTTP_CREATED, response.text
    return data_of(response)


@dataclass(frozen=True)
class Sample:
    """一条待种进归档宽表的读数。"""

    ts: datetime
    value_num: float | None = None
    value_text: str | None = None


@dataclass(frozen=True)
class ArchiveWriter:
    """往 `collect.point_history` 里种几条读数，用完按 `source_id` 清干净。

    ⚠ **只有用例这么写**：生产侧对 `collect` schema 只读（ADR-0003），台账那一
    条链路一行都不许往这里写。
    ⚠ 走的是一条独立连接，不在用例那条回滚事务里，故必须自己清——不清就会留在
    库里毒下一次运行，而现象是「上一轮的样本又出现在这一轮的桶里」。
    """

    database: Database
    source_id: uuid.UUID

    def node_key(self, point_code: str) -> str:
        """这个点位在台账列上写作什么。

        Args: point_code。
        """
        return f"{self.source_id}:{point_code}"

    async def write(self, point_code: str, samples: Sequence[Sample]) -> None:
        """种一批读数。

        Args: point_code, samples。
        """
        statement = text(
            f"INSERT INTO {HISTORY_SCHEMA}.{HISTORY_TABLE}"  # noqa: S608
            " (source_id, point_code, ts, value_num, value_text, quality)"
            " VALUES (:source_id, :point_code, :ts, :value_num,"
            " :value_text, 'good')"
        )
        async with self.database.session() as session:
            for sample in samples:
                await session.execute(
                    statement,
                    {
                        "source_id": self.source_id,
                        "point_code": point_code,
                        "ts": sample.ts,
                        "value_num": sample.value_num,
                        "value_text": sample.value_text,
                    },
                )

    async def clear(self) -> None:
        """把这一轮种下的读数全删掉。"""
        async with self.database.session() as session:
            await session.execute(
                text(
                    f"DELETE FROM {HISTORY_SCHEMA}.{HISTORY_TABLE}"  # noqa: S608
                    " WHERE source_id = :source_id"
                ),
                {"source_id": self.source_id},
            )
