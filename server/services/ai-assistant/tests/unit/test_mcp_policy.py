"""MCP 部署声明不是调用者授权；未知业务映射失败关闭。"""

import json
import uuid

import httpx
import pytest

from ai_assistant.apps.chat.services.tools.mcp_policy import (
    authorize,
    policy_of,
)
from ai_assistant.mcp_settings import parse_write_policies
from ai_assistant.settings import Settings
from ai_assistant.upstream import PlatformClient

NAME = "mcp.synthetic.update_label"
POLICY: dict[str, object] = {
    "required_codes": ["dashboard:view", "dashboard:edit"],
    "target_parameter": "dashboard_id",
    "impact": "更新指定大屏标签",
}


def test_missing_policy_stays_closed(settings: Settings) -> None:
    allowed = settings.model_copy(
        update={"mcp_write_allowed": json.dumps([NAME])}
    )
    assert policy_of(allowed, NAME) is None
    assert (
        authorize(None, frozenset({"dashboard:view", "dashboard:edit"}))
        is False
    )


@pytest.mark.parametrize(
    "codes",
    [
        ["assistant:use"],
        ["assistant:manage"],
        ["llm:manage"],
        ["collect:view", "collect:operate"],
        ["unknown:write"],
        [],
    ],
)
def test_unknown_or_device_permissions_are_rejected(codes: list[str]) -> None:
    body = {NAME: {**POLICY, "required_codes": codes}}
    with pytest.raises(ValueError, match="业务查看与写权限对"):
        parse_write_policies(json.dumps(body))


@pytest.mark.parametrize(
    "name",
    [
        "mcp.a/b.write",
        "mcp.a__b.write",
        "mcp..write",
        "mcp." + "a" * 70 + ".write",
    ],
)
def test_invalid_tool_policy_names_are_rejected(name: str) -> None:
    with pytest.raises(ValueError, match="规范工具名"):
        parse_write_policies(json.dumps({name: POLICY}))


def test_current_policy_requires_real_business_codes(
    settings: Settings,
) -> None:
    configured = Settings.model_validate(
        {
            **settings.model_dump(),
            "mcp_write_allowed": json.dumps([NAME]),
            "mcp_write_policies": json.dumps({NAME: POLICY}),
        }
    )
    policy = policy_of(configured, NAME)
    assert policy is not None
    assert policy.resource_kind == "dashboard"
    assert authorize(policy, frozenset({"assistant:manage"})) is False
    assert authorize(policy, None) is False
    assert (
        authorize(policy, frozenset({"dashboard:view", "dashboard:edit"}))
        is True
    )
    assert policy_of(configured, "mcp.synthetic.other") is None


def test_invalid_policy_refuses_startup_and_bypassed_validation_denies(
    settings: Settings,
) -> None:
    with pytest.raises(ValueError, match="Invalid JSON"):
        Settings.model_validate(
            {**settings.model_dump(), "mcp_write_policies": "not-json"}
        )
    changed = settings.model_copy(
        update={
            "mcp_write_allowed": json.dumps([NAME]),
            "mcp_write_policies": "not-json",
        }
    )
    assert policy_of(changed, NAME) is None


@pytest.mark.parametrize(
    ("kind", "path"),
    [
        ("dashboard", "dashboards"),
        ("dataset", "dataset-tables"),
        ("report", "report-templates"),
    ],
)
async def test_resource_validator_forwards_actual_user_identity(
    kind: str, path: str
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": {"name": "测试资源"}})

    client = PlatformClient(base_url="http://platform.test", timeout_s=1)
    client.use_transport(httpx.MockTransport(handler))
    target = str(uuid.uuid4())
    await client.read_mcp_target(
        {"X-Auth-User-Id": "actual-user"}, kind, target
    )
    assert (
        str(seen[0].url)
        == f"http://platform.test/api/v1/platform/{path}/{target}"
    )
    assert seen[0].headers["X-Auth-User-Id"] == "actual-user"
    await client.close()


async def test_malformed_target_never_reaches_platform() -> None:
    client = PlatformClient(base_url="http://platform.test", timeout_s=1)
    client.use_transport(
        httpx.MockTransport(lambda _request: pytest.fail("must not dispatch"))
    )
    with pytest.raises(ValueError, match="UUID"):
        await client.read_mcp_target({}, "dashboard", "../admin")
    await client.close()
