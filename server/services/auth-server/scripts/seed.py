"""把权限码目录、内置角色、内置路由规则与种子账号写进库。可重复执行。

幂等靠 `uuid5` 内容寻址与业务唯一键，不靠「先查再插」。
内置对象**全量覆盖**：目录是真源，库里被手工改过的内置项会被改回来。
"""

import asyncio
import sys
import uuid

from pydantic import EmailStr, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth import catalog, route_catalog
from auth_server.apps.auth.crud import (
    permission_crud,
    role_crud,
    route_rule_crud,
    user_crud,
)
from auth_server.apps.auth.models import Permission, Role, RouteRule, User
from auth_server.apps.auth.services.matching import RuleView, is_redundant
from auth_server.settings import Settings
from lib.auth import PasswordHasher
from lib.config import load_settings_or_exit
from lib.db import Database
from lib.logging import configure_logging, get_logger
from lib.utils.ids import uuid5_of

_logger = get_logger("auth.seed")

# 内容寻址命名空间，跨环境同码同 id
NAMESPACE = uuid.UUID("6f9d6a24-1a5b-5a4f-9a5e-0f1a2b3c4d5e")


class SeedSettings(BaseSettings):
    """种子账号配置。密码无默认值——弱默认的管理员口令等于没有口令。"""

    model_config = SettingsConfigDict(
        env_prefix="AUTH_SEED_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    admin_username: str = "admin"
    admin_email: EmailStr = "admin@example.com"
    admin_password: SecretStr


def check_catalog() -> list[str]:
    """种子自检。返回问题列表，非空即拒绝写库。"""
    problems: list[str] = []
    problems.extend(_check_rule_codes())
    problems.extend(_check_role_derivation())
    problems.extend(_check_rule_redundancy())
    return problems


def _check_rule_codes() -> list[str]:
    problems: list[str] = []
    for rule in route_catalog.ROUTE_RULES:
        unknown = set(rule.codes) - catalog.ALL_CODES
        if unknown:
            problems.append(
                f"规则 {rule.http_method} {rule.path_pattern} "
                f"引用了未登记的权限码：{sorted(unknown)}"
            )
    return problems


def _check_role_derivation() -> list[str]:
    by_name = {role.name: role for role in catalog.ROLES}
    problems: list[str] = []
    admin = by_name[catalog.ROLE_ADMIN]
    if frozenset(admin.codes) != catalog.ALL_CODES:
        problems.append("admin 角色必须等于全部权限码")
    viewer = by_name[catalog.ROLE_VIEWER]
    if frozenset(viewer.codes) != frozenset(catalog.VIEW_CODES):
        problems.append("viewer 角色必须等于全部 view 档权限码")
    return problems


def _check_rule_redundancy() -> list[str]:
    views = [
        RuleView(
            path_pattern=rule.path_pattern,
            http_method=rule.http_method,
            permission_codes=frozenset(rule.codes),
            match_mode=rule.match_mode,
            priority=rule.priority,
        )
        for rule in route_catalog.ROUTE_RULES
    ]
    return [
        f"规则 {view.http_method} {view.path_pattern} 与更宽的规则判定相同，"
        "属于噪音"
        for view in views
        if is_redundant(view, views)
    ]


async def sync_permissions(session: AsyncSession) -> dict[str, uuid.UUID]:
    """全量覆盖权限码目录，返回码 → id。

    Args: session。
    """
    ids: dict[str, uuid.UUID] = {}
    for spec in catalog.PERMISSIONS:
        entity_id = uuid5_of(NAMESPACE, "permission", spec.code)
        existing = await permission_crud.get(session, entity_id)
        if existing is None:
            existing = Permission(id=entity_id, code=spec.code)
            session.add(existing)
        existing.name = spec.name
        existing.description = spec.description
        existing.group_code = spec.group_code
        existing.group_label = spec.group_label
        existing.sort_order = spec.sort_order
        existing.kind = spec.kind
        existing.is_builtin = True
        ids[spec.code] = entity_id
    await session.flush()
    return ids


async def sync_roles(
    session: AsyncSession, permission_ids: dict[str, uuid.UUID]
) -> None:
    """全量覆盖内置角色及其权限集。

    Args: session, permission_ids。
    """
    for spec in catalog.ROLES:
        role = await role_crud.get_by_name(session, spec.name)
        if role is None:
            role = Role(
                id=uuid5_of(NAMESPACE, "role", spec.name), name=spec.name
            )
            session.add(role)
        role.description = spec.description
        role.is_builtin = True
        await session.flush()
        await role_crud.replace_permissions(
            session,
            role_id=role.id,
            permission_ids=frozenset(
                permission_ids[code] for code in spec.codes
            ),
        )
    await session.flush()


async def sync_route_rules(session: AsyncSession) -> None:
    """全量覆盖内置路由规则。人工新建的规则不受影响。

    Args: session。
    """
    for spec in route_catalog.ROUTE_RULES:
        rule = await route_rule_crud.get_by_key(
            session,
            path_pattern=spec.path_pattern,
            method=spec.http_method,
        )
        if rule is None:
            rule = RouteRule(
                path_pattern=spec.path_pattern,
                http_method=spec.http_method,
            )
            session.add(rule)
        rule.permission_codes = sorted(spec.codes)
        rule.match_mode = spec.match_mode
        rule.priority = spec.priority
        rule.description = spec.description
        rule.is_enabled = True
        rule.is_builtin = True
    await session.flush()


async def ensure_admin(
    session: AsyncSession, seed: SeedSettings, hasher: PasswordHasher
) -> bool:
    """确保存在种子管理员账号。已存在时**不改密码**。

    Args: session, seed, hasher。
    """
    existing = await user_crud.get_by_login(session, seed.admin_username)
    if existing is not None:
        return False
    role = await role_crud.get_by_name(session, catalog.ROLE_ADMIN)
    if role is None:
        raise RuntimeError("内置 admin 角色缺失，请先同步角色")
    session.add(
        User(
            username=seed.admin_username,
            email=str(seed.admin_email),
            hashed_password=hasher.hash(seed.admin_password.get_secret_value()),
            full_name="系统管理员",
            role_id=role.id,
            is_active=True,
        )
    )
    await session.flush()
    return True


async def run(settings: Settings, seed: SeedSettings) -> None:
    """执行一次完整同步。

    Args: settings, seed。
    """
    database = Database(
        dsn=settings.dsn(), search_path=settings.postgres_schema
    )
    hasher = PasswordHasher()
    try:
        async with database.session() as session:
            permission_ids = await sync_permissions(session)
            await sync_roles(session, permission_ids)
            await sync_route_rules(session)
            created = await ensure_admin(session, seed, hasher)
        _logger.info(
            "seed_completed",
            "种子同步完成",
            permissions=len(catalog.PERMISSIONS),
            roles=len(catalog.ROLES),
            route_rules=len(route_catalog.ROUTE_RULES),
            admin_created=created,
        )
    finally:
        await database.dispose()


def main() -> None:
    """种子入口。自检不过即以非零码退出，不写库。"""
    settings = load_settings_or_exit(Settings)
    seed = load_settings_or_exit(SeedSettings)
    configure_logging(
        service=settings.app_name,
        role="seed",
        instance=settings.app_instance,
        level=settings.app_log_level,
        log_format=settings.app_log_format,
    )
    problems = check_catalog()
    if problems:
        for line in problems:
            sys.stderr.write(f"种子自检失败：{line}\n")
        raise SystemExit(2)
    asyncio.run(run(settings, seed))


if __name__ == "__main__":
    main()
