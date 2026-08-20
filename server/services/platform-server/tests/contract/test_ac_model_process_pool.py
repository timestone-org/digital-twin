"""训练进程池的三条跨进程约定：子进程冷 import、两头可搬运、旧工件的类路径。

⚠ 违反时类型检查与 lint 全绿，线上只表现为「训练子进程猝死、整池从此不可
用」：worker 的用例注的是线程池，与父进程共享 sys.modules，永远撞不上这三条
（docs/AC_MODEL_DESIGN.md §4）。
"""

import io
import pickle
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial
from multiprocessing import get_context

import pytest

from platform_server.apps.hvac.modeling.features import (
    EpisodeSample,
    StartConditions,
)
from platform_server.apps.hvac.modeling.training import (
    MIN_SAMPLES,
    InsufficientSamples,
    train,
)
from platform_server.apps.hvac.rooms import (
    METRIC_FAN_FREQUENCY,
    METRIC_WORKSHOP_HUMIDITY,
    METRIC_WORKSHOP_TEMP,
    MetricBand,
    RoomUnit,
)

# 子进程解 pickle 时从零 import 的就是这几个模块；父进程里 services 早已装好，
# 环被装配顺序盖住，故必须开一个新解释器才验得到
COLD_IMPORT_MODULES = (
    "platform_server.apps.hvac.modeling.training",
    "platform_server.apps.hvac.modeling.features",
    "platform_server.apps.hvac.modeling.artifact",
)
# 库里存量工件的 pickle 里写死的旧类路径
LEGACY_MODULE = "platform_server.apps.hvac.services.ac_startup_frames"
TZ = "Asia/Shanghai"
HALF_LIFE_DAYS = 30.0
# 真起子进程 + 装 sklearn + 拟合六对森林，慢机器上给足
POOL_TIMEOUT_S = 180.0


def units() -> list[RoomUnit]:
    """两台机组，各带一条温度达标范围。"""
    band = MetricBand(lower=Decimal("18"), upper=Decimal("26"))
    return [
        RoomUnit(serial=serial, bands={METRIC_WORKSHOP_TEMP: band})
        for serial in ("A", "B")
    ]


def samples() -> list[EpisodeSample]:
    """刚好够训的一批事件：零与非零时长都有，两段模型才都拟合得起来。

    ⚠ 时长必须与上面那条达标范围对得上：起始温度落在带内的记 0 分钟，超限的
    按超限量给时长。带内开机却记着非零时长的事件会被训练入口的甄别剔掉
    （`modeling/curation.py`），凑不够 `MIN_SAMPLES` 就根本训不起来。
    """
    base = datetime(2026, 1, 5, tzinfo=UTC)
    return [
        EpisodeSample(
            conditions=StartConditions(
                started_at=base + timedelta(hours=at),
                running_set=("A",) if at % 2 else ("A", "B"),
                idle_minutes=at % 7,
                readings={
                    serial: {
                        METRIC_WORKSHOP_TEMP: 25.0 + at % 5,
                        METRIC_WORKSHOP_HUMIDITY: 50.0 + at % 3,
                        METRIC_FAN_FREQUENCY: 40.0,
                    }
                    for serial in ("A", "B")
                },
            ),
            duration_minutes=max(0, at % 5 - 1) * 4,
        )
        for at in range(MIN_SAMPLES)
    ]


@pytest.mark.parametrize("module", COLD_IMPORT_MODULES)
def test_the_training_entry_imports_in_a_bare_interpreter(module: str) -> None:
    done = subprocess.run(  # noqa: S603  # 参数全是本文件里的字面常量
        [sys.executable, "-c", f"import {module}"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert done.returncode == 0, done.stderr


def test_training_runs_through_a_real_spawned_process_pool() -> None:
    fitted = partial(
        train,
        samples(),
        units=units(),
        timezone=TZ,
        half_life_days=HALF_LIFE_DAYS,
    )
    # ⚠ 必须钉死 spawn：Linux 默认 fork，子进程直接继承父进程的 sys.modules，
    # 跑的根本不是 Windows 上那条从零 import 的路径
    with ProcessPoolExecutor(
        max_workers=1, mp_context=get_context("spawn")
    ) as pool:
        trained = pool.submit(fitted).result(timeout=POOL_TIMEOUT_S)
    assert trained.sample_count == MIN_SAMPLES
    assert trained.artifact.payload
    assert trained.oof


def test_a_refusal_survives_the_trip_back_from_the_subprocess() -> None:
    """⚠ 拒训的原因要原样回到父进程：它会直接落到模型行上给操作员看。"""
    fitted = partial(
        train,
        samples()[: MIN_SAMPLES - 1],
        units=units(),
        timezone=TZ,
        half_life_days=HALF_LIFE_DAYS,
    )
    with (
        ProcessPoolExecutor(
            max_workers=1, mp_context=get_context("spawn")
        ) as pool,
        pytest.raises(InsufficientSamples) as caught,
    ):
        pool.submit(fitted).result(timeout=POOL_TIMEOUT_S)
    assert caught.value.got == MIN_SAMPLES - 1
    assert str(caught.value).count("可用事件只有") == 1


def test_stored_artifacts_still_resolve_the_legacy_unit_path() -> None:
    # find_class 就是 pickle 解类路径时走的那个口
    reader = pickle.Unpickler(io.BytesIO(b""))  # noqa: S301 - 不解任何数据
    assert reader.find_class(LEGACY_MODULE, "RoomUnit") is RoomUnit
    assert reader.find_class(LEGACY_MODULE, "MetricBand") is MetricBand
