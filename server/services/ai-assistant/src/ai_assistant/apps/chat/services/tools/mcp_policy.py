"""MCP 写授权只来自部署业务政策和已认证调用者。"""

from dataclasses import dataclass

from ai_assistant.mcp_settings import ResourceKind, parse_write_policies
from ai_assistant.settings import Settings

CONFIRMATION_CAPABILITY = "mcp.confirm_write"


@dataclass(frozen=True)
class McpWritePolicy:
    """已校验的具体业务动作政策。"""

    required_codes: frozenset[str]
    target_parameter: str
    impact: str
    resource_kind: ResourceKind = "dashboard"


def policies_of(settings: Settings) -> dict[str, McpWritePolicy]:
    """取得已知映射；绕过启动校验的配置也失败关闭。

    Args: settings。
    """
    try:
        given = parse_write_policies(settings.mcp_write_policies)
    except ValueError:
        return {}
    return {
        name: McpWritePolicy(
            required_codes=policy.required_codes,
            target_parameter=policy.target_parameter,
            impact=policy.impact,
            resource_kind=policy.resource_kind,
        )
        for name, policy in given.items()
    }


def policy_of(settings: Settings, name: str) -> McpWritePolicy | None:
    """具体工具必须同时属于部署白名单和已知业务政策。

    Args: settings, name。
    """
    if name not in settings.mcp_write_names():
        return None
    return policies_of(settings).get(name)


def authorize(
    policy: McpWritePolicy | None, codes: frozenset[str] | None
) -> bool:
    """没有可信权限或没有明确政策时一律拒绝。

    Args: policy, codes。
    """
    return (
        policy is not None
        and codes is not None
        and policy.required_codes <= codes
    )
