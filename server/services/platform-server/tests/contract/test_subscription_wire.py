"""hub 订阅表的口径两侧比对：发布循环按它推导「现在谁在看」。

跨 schema 读不许共享 ORM 模型、服务之间不许互相 import，所以表名与列名在两个
仓里各写一份，只能靠比对守。⚠ 漂了不会报错，只会让发布循环「什么都读不到」
——而空结果与「现在确实没人在看」分不开。

⚠ 采集侧的快照与运行态不在这里：那几条缝两侧都 import `collectwire`，漂移是
import 错误而不是空结果，不需要比对（ADR-0017）。
"""

from pathlib import Path

from platform_server.apps.dashboard.services.viewers import (
    CONNECTION_COLUMN,
    SUBSCRIPTION_SCHEMA,
    SUBSCRIPTION_TABLE,
    TOPIC_COLUMN,
)

ROOT = Path(__file__).resolve().parents[5]
HUB = ROOT / "server" / "services" / "realtime-hub" / "src" / "realtime_hub"
SUBSCRIPTION_MODEL = HUB / "apps" / "channel" / "models" / "subscription.py"
HUB_SETTINGS = HUB / "settings.py"


def test_the_subscription_table_is_the_one_the_hub_writes() -> None:
    declared = SUBSCRIPTION_MODEL.read_text(encoding="utf-8")
    assert '__tablename__ = "subscription"' in declared
    assert f"{SUBSCRIPTION_SCHEMA}.subscription" == SUBSCRIPTION_TABLE


def test_the_columns_we_read_are_the_ones_the_hub_declares() -> None:
    declared = SUBSCRIPTION_MODEL.read_text(encoding="utf-8")
    assert f"{TOPIC_COLUMN}: Mapped" in declared
    assert f"{CONNECTION_COLUMN}: Mapped" in declared


def test_the_subscription_schema_is_the_one_the_hub_migrates() -> None:
    assert f'DB_SCHEMA = "{SUBSCRIPTION_SCHEMA}"' in HUB_SETTINGS.read_text(
        encoding="utf-8"
    )
