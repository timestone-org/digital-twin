"""BDM 组装载荷与特征帧可以跨真实进程传递。"""

import multiprocessing
import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace
from datetime import datetime

import httpx
import pytest
from unit.test_modeling_bdm import NOW, config, connection, series_response

from platform_server.apps.modeling.operators.bdm import BdmSourceConfig
from platform_server.apps.modeling.operators.frame import Frame
from platform_server.apps.modeling.services import bdm_frame
from platform_server.apps.modeling.services.bdm_client import BdmClient
from platform_server.apps.modeling.services.bdm_frame import _build_frame
from platform_server.apps.modeling.services.bdm_window import BdmWindow
from platform_server.apps.modeling.services.run_pool import NodePool


def build_with_pid(
    reads: list[bdm_frame._Read],
    source: BdmSourceConfig,
    window: BdmWindow,
    now: datetime,
) -> Frame:
    frame = _build_frame(reads, source, window, now)
    return replace(frame, rows=((os.getpid(),),))


async def test_assembly_runs_in_another_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = NodePool(
        factory=lambda: ProcessPoolExecutor(
            max_workers=1, mp_context=multiprocessing.get_context("spawn")
        )
    )

    def respond(_request: httpx.Request) -> httpx.Response:
        return series_response([{"ct": "2026-10-25 00:00:00", "value": 3}])

    monkeypatch.setattr(bdm_frame, "_build_frame", build_with_pid)
    try:
        async with BdmClient(
            replace(connection(), load_timeout_s=30),
            transport=httpx.MockTransport(respond),
        ) as client:
            frame = await bdm_frame.load_frame(
                client, config(identifiers=["p1"]), now=NOW, pool=pool
            )
        assert frame.rows[0][0] != os.getpid()
        assert frame.keys == ("p1",)
        assert frame.index == (1792857600000,)
    finally:
        pool.shutdown()
