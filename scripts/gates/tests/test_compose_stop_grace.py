"""编排给每个服务进程的关停宽限必须盖得住它自己的 drain 上限。"""

from __future__ import annotations

import re
import unittest
from pathlib import Path
from typing import cast

import yaml

ROOT: Path = Path(__file__).resolve().parents[3]
COMPOSE_FILES: tuple[Path, ...] = (
    ROOT / "docker" / "compose.yml",
    ROOT / "docker" / "compose.no-ai.yml",
)
# drain 收完之后还要关连接池、让租约、等 uvicorn 把在途请求送走
SHUTDOWN_MARGIN_S = 10.0
# knowledge-worker 的 drain 上限写死在代码里，不走 APP_DRAIN_TIMEOUT_S
FIXED_DRAIN_S: dict[str, float] = {"knowledge-worker": 30.0}
DRAIN_VARIABLE = re.compile(r"^[A-Z]+_APP_DRAIN_TIMEOUT_S$")
DEFAULT_VALUE = re.compile(r"^\$\{[A-Z0-9_]+:-([0-9.]+)\}$")
DURATION = re.compile(r"^(?:(\d+)m)?(?:(\d+)s)?$")

type Mapping = dict[str, object]


def _mapping(value: object) -> Mapping:
    """收敛 YAML 对象边界。Args: value。"""
    if not isinstance(value, dict):
        raise TypeError("Compose 字段必须是对象")
    return cast(Mapping, value)


def _services(path: Path) -> dict[str, Mapping]:
    """读出一份编排里由服务代码单元起的进程。Args: path。"""
    loaded: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    services = _mapping(_mapping(loaded).get("services"))
    selected: dict[str, Mapping] = {}
    for name, raw in services.items():
        service = _mapping(raw)
        build = service.get("build")
        if isinstance(build, dict) and _mapping(build).get("context") == (
            "../server"
        ):
            selected[name] = service
    return selected


def _drain_s(name: str, service: Mapping) -> float:
    """服务 drain 上限的缺省值。Args: name, service。"""
    if name in FIXED_DRAIN_S:
        return FIXED_DRAIN_S[name]
    environment = _mapping(service.get("environment"))
    for key, value in environment.items():
        if DRAIN_VARIABLE.fullmatch(key):
            match = DEFAULT_VALUE.fullmatch(str(value))
            if match is None:
                raise AssertionError(f"{name} 的 {key} 没有缺省值")
            return float(match[1])
    return 0.0


def _seconds(raw: object) -> float:
    """把 `1m30s` 形态的 Compose 时长换成秒。Args: raw。"""
    match = DURATION.fullmatch(str(raw))
    if match is None or not any(match.groups()):
        raise AssertionError(f"无法解析的时长：{raw!r}")
    minutes, seconds = match.groups()
    return float(int(minutes or 0) * 60 + int(seconds or 0))


class StopGracePeriodTests(unittest.TestCase):
    """缺省 10s 的强杀会抢在 drain 前面，归档缓冲与租约让位都跑不到。"""

    def test_grace_period_exceeds_drain_budget(self) -> None:
        for path in COMPOSE_FILES:
            for name, service in _services(path).items():
                if name == "database-migrate":
                    continue
                with self.subTest(file=path.name, service=name):
                    grace = service.get("stop_grace_period")
                    assert grace is not None, "未设 stop_grace_period"
                    assert (
                        _seconds(grace)
                        >= _drain_s(name, service) + SHUTDOWN_MARGIN_S
                    )


if __name__ == "__main__":
    unittest.main()
