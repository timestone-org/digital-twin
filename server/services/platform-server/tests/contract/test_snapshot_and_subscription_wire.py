"""两处跨服务读的口径两侧比对：collector 的快照、hub 的订阅表。

两者都不经 ORM 模型或 import 共享（服务之间不许互相 import、跨 schema 读不许
共享模型），所以名字在两个仓里各写一份。⚠ 漂了不会报错，只会让发布循环
「什么都读不到」——而空结果与「现在确实没人在看 / 没有值」分不开。
"""

from pathlib import Path

from platform_server.apps.collect.services.snapshot_source import (
    KEY_PREFIX,
    SNAPSHOT_FIELDS,
)
from platform_server.apps.dashboard.services.viewers import (
    CONNECTION_COLUMN,
    SUBSCRIPTION_SCHEMA,
    SUBSCRIPTION_TABLE,
    TOPIC_COLUMN,
)

ROOT = Path(__file__).resolve().parents[5]
COLLECTOR = (
    ROOT
    / "server"
    / "services"
    / "collector-server"
    / "src"
    / "collector_server"
)
HUB = ROOT / "server" / "services" / "realtime-hub" / "src" / "realtime_hub"
SUBSCRIPTION_MODEL = HUB / "apps" / "channel" / "models" / "subscription.py"
HUB_SETTINGS = HUB / "settings.py"


def collector_sources() -> str:
    """collector 的全部源码，按文件名排序拼起来。

    ⚠ 不钉死在某个文件上：那边挪一次文件本条就假红，而我们要守的是名字。
    """
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(COLLECTOR.rglob("*.py"))
    )


def test_the_snapshot_key_prefix_is_the_one_collector_writes() -> None:
    assert f'"{KEY_PREFIX}"' in collector_sources()


def test_every_snapshot_field_is_one_collector_encodes() -> None:
    # 字段名漂一个，那个点位就永远没有值，而大屏上看着像「设备没上报」
    written = collector_sources()
    assert all(f'"{field}"' in written for field in SNAPSHOT_FIELDS)


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
