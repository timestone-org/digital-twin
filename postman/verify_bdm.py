"""在本地 Postman 模拟上验证真实能管 HTTP 客户端与计算进程。"""

import asyncio
import json
import sys
from datetime import UTC, datetime

from pydantic import SecretStr

from platform_server.apps.modeling.operators.bdm import BdmSourceConfig
from platform_server.apps.modeling.schemas.bdm import BdmCatalogQuery
from platform_server.apps.modeling.schemas.bdm_discovery import (
    BdmIndicatorQuery,
)
from platform_server.apps.modeling.services.bdm_catalog import (
    read_catalog,
    read_indicators,
)
from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmConnection,
    BdmReadFailed,
)
from platform_server.apps.modeling.services.bdm_frame import load_frame
from platform_server.apps.modeling.services.run_pool import NodePool

FORMULA_ROWS = 4
HISTORY_ROWS = 1001
HISTORY_COLUMNS = 2


def check(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def config(code: str = "DEMO_ENERGY") -> BdmSourceConfig:
    return BdmSourceConfig(
        kind="formula",
        identifiers=[code],
        granularity="minute",
        interval_minutes=15,
        since="2026-10-27T00:00:00Z",
        until="2026-10-27T01:00:00Z",
    )


async def verify_frames(connection: BdmConnection, pool: NodePool) -> None:
    async with BdmClient(connection) as client:
        frame = await load_frame(
            client, config(), now=datetime.now(UTC), pool=pool
        )
        check(
            frame.row_count == FORMULA_ROWS,
            "15-minute request must return four periods",
        )
        check(frame.rows[1] == (None,), "omitted value must stay null")
        check(
            not frame.provenance.is_truncated, "small result must be complete"
        )
        history = BdmSourceConfig(
            kind="point",
            identifiers=["demo-point-1", "demo-point-2"],
            since="2026-10-26T00:00:00Z",
            until="2026-10-27T00:00:00Z",
            row_limit=1001,
        )
        samples = await load_frame(
            client, history, now=datetime.now(UTC), pool=pool
        )
        check(
            samples.row_count == HISTORY_ROWS,
            "independent pages must form 1001 rows",
        )
        check(
            len(samples.columns) == HISTORY_COLUMNS,
            "each identifier must remain a column",
        )
        check(
            not samples.provenance.is_truncated, "exact final page is complete"
        )
        for code in ("DEMO_LEGACY", "DEMO_HTTP_ERROR"):
            try:
                await load_frame(
                    client, config(code), now=datetime.now(UTC), pool=pool
                )
            except BdmReadFailed:
                continue
            raise RuntimeError(
                f"{code} should fail rather than return empty data"
            )


async def main() -> None:
    connection = BdmConnection(
        base_url=sys.argv[1],
        api_key=SecretStr("local-simulation-only-0123456789abcdef"),
        timezone="Asia/Shanghai",
        timeout_s=3,
        load_timeout_s=20,
    )
    catalog = await read_catalog(connection, BdmCatalogQuery(code="DEMO.T1"))
    check(len(catalog.items) == 1, "exact point code filter failed")
    indicators = await read_indicators(
        connection, BdmIndicatorQuery(code="demo.energy")
    )
    check(
        [source.is_selectable for source in indicators.items[0].sources]
        == [True, False],
        "binding eligibility failed",
    )
    pool = NodePool()
    try:
        await verify_frames(connection, pool)
    finally:
        pool.shutdown()
    sys.stdout.write(
        json.dumps(
            {
                "result": "passed",
                "transport": "real HTTP",
                "compute": "process pool",
                "upstream": "synthetic contract fixture",
            }
        )
        + "\n"
    )


if __name__ == "__main__":
    asyncio.run(main())
