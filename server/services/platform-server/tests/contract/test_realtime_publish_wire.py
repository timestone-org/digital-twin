"""与 realtime-hub 之间的线上口径两侧比对：路径、入参字段、密钥头、主题域。

服务之间不许互相 import，所以这些名字在两个仓里各写一份。**这份重复只能靠
比对守**：路径或字段名漂了不会有类型错误，只会让每一次推送都 404 / 422，而
现象是「大屏没有实时值」，与真实原因隔得极远。

⚠ 最后几条守的是 ADR-0007 的核心断言：hub 既不认识大屏，也不认识采集数据源。
两条链路的推送方名字还必须不同——同名的话，一方对账会把另一方的主题全注销掉。
"""

import re
from pathlib import Path

from platform_server.apps.collect.services.point_frames import (
    KEY_ERROR,
    KEY_QUALITY,
    KEY_TIMESTAMP_MS,
    KEY_VALUE,
    POINT_STATES,
)
from platform_server.apps.collect.services.topics import (
    PUBLISHER_NAME as COLLECT_PUBLISHER,
)
from platform_server.apps.collect.services.topics import (
    TOPIC_PREFIX as COLLECT_PREFIX,
)
from platform_server.apps.collect.services.topics import (
    TOPIC_REQUIRED_CODE as COLLECT_CODE,
)
from platform_server.apps.dashboard.services.topics import (
    PUBLISHER_NAME,
    TOPIC_PREFIX,
    TOPIC_REQUIRED_CODE,
    TOPIC_SEPARATOR,
)
from platform_server.realtime import PUBLISH_PATH, TOPICS_PATH

ROOT = Path(__file__).resolve().parents[5]
HUB = ROOT / "server" / "services" / "realtime-hub" / "src" / "realtime_hub"
INTERNAL_API = HUB / "apps" / "channel" / "api" / "internal.py"
TOPIC_SCHEMAS = HUB / "apps" / "channel" / "schemas" / "topic.py"
HUB_DEPS = HUB / "apps" / "channel" / "deps.py"
HUB_SETTINGS = HUB / "settings.py"
DATASOURCE_CONTRACT = (
    ROOT / "web" / "packages" / "contracts" / "src" / "datasource.ts"
)
_UNION = re.compile(
    r"export const (?P<name>\w+) = \[(?P<body>[^\]]*)\] as const", re.DOTALL
)
_MEMBER = re.compile(r"'([^']+)'")


def hub_text(path: Path) -> str:
    """读 hub 的一份源码。

    Args: path。
    """
    return path.read_text(encoding="utf-8")


def test_the_topics_path_is_the_one_the_hub_serves() -> None:
    prefix = 'prefix=f"{INTERNAL_PREFIX}/realtime"'
    assert prefix in hub_text(INTERNAL_API)
    assert 'INTERNAL_PREFIX = "/internal/v1"' in hub_text(HUB_SETTINGS)
    assert TOPICS_PATH == "/internal/v1/realtime/topics"


def test_the_publish_path_is_the_one_the_hub_serves() -> None:
    assert '@router.post("/publish"' in hub_text(INTERNAL_API)
    assert PUBLISH_PATH == "/internal/v1/realtime/publish"


def test_the_declare_payload_matches_the_hub_input_model() -> None:
    # ⚠ hub 的入参是 extra="forbid"：字段名拼错会被响亮拒绝，而不是静默不生效
    declared = hub_text(TOPIC_SCHEMAS)
    for field in ("topic:", "required_code:", "publisher:"):
        assert field in declared


def test_the_publish_payload_matches_the_hub_input_model() -> None:
    published = hub_text(TOPIC_SCHEMAS)
    assert "class PublishIn" in published
    assert "items: list[dict[str, Any]]" in published


def test_the_service_key_header_is_the_one_the_hub_compares() -> None:
    # hub 的形参名 `x_service_key` 就是头名 `X-Service-Key`
    assert "x_service_key" in hub_text(HUB_DEPS)


def test_the_hub_does_not_know_the_dashboard_topic_namespace() -> None:
    # ⚠ 这一条是 ADR-0007 的核心：主题对 hub 是不透明键，
    # 「dashboard: 开头的主题是一张大屏」这件事只有本服务知道
    namespace = f"{TOPIC_PREFIX}{TOPIC_SEPARATOR}"
    assert all(
        namespace not in hub_text(path) for path in sorted(HUB.rglob("*.py"))
    )


def test_the_item_states_match_the_frontend_union() -> None:
    # 条目的 `state` 是客户端唯一的分支依据，两侧漂了不会报错，只会让某一档
    # 悄悄落进 default 分支
    text = DATASOURCE_CONTRACT.read_text(encoding="utf-8")
    unions = {
        match.group("name"): frozenset(_MEMBER.findall(match.group("body")))
        for match in _UNION.finditer(text)
    }
    assert set(POINT_STATES) == unions["POINT_STATES"]


def test_the_item_field_names_match_the_frontend_sample() -> None:
    text = DATASOURCE_CONTRACT.read_text(encoding="utf-8")
    for field in (KEY_VALUE, KEY_TIMESTAMP_MS, KEY_QUALITY, KEY_ERROR):
        assert f"{field}:" in text


def test_the_hub_does_not_know_the_code_that_guards_dashboards() -> None:
    # 声明的权限码由推送方在登记时给出，hub 只做一次集合包含判断
    assert all(
        TOPIC_REQUIRED_CODE not in hub_text(path)
        for path in sorted(HUB.rglob("*.py"))
    )


def test_the_hub_does_not_know_the_collect_topic_namespace() -> None:
    # 与大屏那条同理：`collect:` 开头的主题是一个采集数据源，只有本服务知道
    namespace = f"{COLLECT_PREFIX}{TOPIC_SEPARATOR}"
    assert all(
        namespace not in hub_text(path) for path in sorted(HUB.rglob("*.py"))
    )


def test_the_hub_does_not_know_the_code_that_guards_collect_sources() -> None:
    assert all(
        COLLECT_CODE not in hub_text(path) for path in sorted(HUB.rglob("*.py"))
    )


def test_the_two_lanes_reconcile_under_different_publisher_names() -> None:
    # ⚠ 同名的话，一方对账时会把另一方的主题当成「多出来的」全部注销掉，
    # 表现是两边的实时值交替消失，而两条链路各自看都没问题
    assert PUBLISHER_NAME != COLLECT_PUBLISHER


def test_the_two_topic_namespaces_do_not_collide() -> None:
    assert TOPIC_PREFIX != COLLECT_PREFIX
