"""采集计划的两侧字段比对：platform 下发的与 collector 期望的。

服务之间不许互相 import，所以计划的形状在两个仓里各写一份。**这份重复只能靠
比对守**，而且这里漏字段比漏路径更隐蔽：collector 的 `PlanPoint` 给了缺省值且
`extra="ignore"`，所以 platform 少发一个字段**不会报错、不会 422**，只会让该点位
静默按缺省跑。

⚠ 最贵的那一个是 `archive_max_interval_ms`：缺省 0 = 不发心跳，于是一条常年不变
的曲线在库里永远只有一个点，读侧分不出「没变」与「没采到」。
"""

import re
from pathlib import Path

from platform_server.apps.collect.schemas.plan import (
    PlanPointOut,
    PlanSourceOut,
)

ROOT = Path(__file__).resolve().parents[5]
COLLECTOR_PLAN = (
    ROOT
    / "server"
    / "services"
    / "collector-server"
    / "src"
    / "collector_server"
    / "apps"
    / "collect"
    / "schemas"
    / "plan.py"
)

# collector 侧声明了、但 platform 有意不下发的字段，每条都要有理由。
# 不在这张表里的缺失即为漏发。
INTENTIONALLY_NOT_SENT = {
    # 一期不下发凭据明文：credential_enc 的解密与轮换尚未落地，
    # 下发一个假的比不下发更糟（见 schemas/plan.py 的 PlanSourceOut）
    "username",
    "password",
}

_FIELD = re.compile(r"^    (?P<name>[a-z][a-z0-9_]*)\s*:", re.MULTILINE)


def _declared_fields(source: str, class_name: str) -> set[str]:
    """抽出 collector 侧某个 pydantic 模型声明的字段名。

    Args: source, class_name。
    """
    start = source.index(f"class {class_name}(")
    rest = source[start:]
    end = rest.find("\nclass ", 1)
    body = rest if end < 0 else rest[:end]
    return {
        match.group("name")
        for match in _FIELD.finditer(body)
        if match.group("name") != "model_config"
    }


def test_collector_plan_schema_is_readable() -> None:
    """比对的前提：真读到了 collector 的计划定义。

    读不到时下面两条会双双「通过」，那是最坏的结果。
    """
    assert COLLECTOR_PLAN.is_file()
    assert "class PlanPoint(" in COLLECTOR_PLAN.read_text(encoding="utf-8")


def test_every_point_field_collector_expects_is_sent() -> None:
    """collector 期望的点位字段，platform 必须逐个下发。"""
    expected = _declared_fields(
        COLLECTOR_PLAN.read_text(encoding="utf-8"), "PlanPoint"
    )
    missing = expected - set(PlanPointOut.model_fields) - INTENTIONALLY_NOT_SENT
    assert missing == set()


def test_every_source_field_collector_expects_is_sent() -> None:
    """collector 期望的数据源字段，platform 必须逐个下发。"""
    expected = _declared_fields(
        COLLECTOR_PLAN.read_text(encoding="utf-8"), "PlanSource"
    )
    missing = (
        expected - set(PlanSourceOut.model_fields) - INTENTIONALLY_NOT_SENT
    )
    assert missing == set()


def test_archive_policy_is_carried_per_point() -> None:
    """归档三件套逐点下发，缺一个就是整条曲线的静默降级。"""
    fields = set(PlanPointOut.model_fields)
    assert "archive_enabled" in fields
    assert "deadband" in fields
    assert "archive_max_interval_ms" in fields
