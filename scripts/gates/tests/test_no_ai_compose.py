"""无 AI 部署保留业务配置、基础设施拓扑与可选层级图契约。"""

from __future__ import annotations

import json
import os
import re
import subprocess
import unittest
from collections import Counter
from collections.abc import Mapping
from pathlib import Path
from typing import cast

from _compose_config import compose_environments, fallback_shape, interpolations

type JsonValue = str | int | float | bool | list[JsonValue] | JsonObject | None
type JsonObject = dict[str, JsonValue]

ROOT: Path = Path(__file__).resolve().parents[3]
COMPOSE: Path = ROOT / "docker" / "compose.no-ai.yml"
BASE_COMPOSE: Path = ROOT / "docker" / "compose.yml"
TEMPLATE: Path = ROOT / "docker" / "no-ai.env.example"
AI_PREFIXES: tuple[str, ...] = (
    "ASSISTANT_",
    "KNOWLEDGE_",
    "LLM_",
    "PLATFORM_LLM_",
    "MINERU_",
)
BUSINESS_SERVICES: tuple[str, ...] = (
    "auth-server",
    "platform-server",
    "platform-worker",
    "platform-publisher",
    "collector-server",
    "opcua-server",
    "realtime-hub",
    "hierarchy-server",
)
PLATFORM_ROLES: tuple[str, ...] = (
    "platform-server",
    "platform-worker",
    "platform-publisher",
    "database-migrate",
)
PLATFORM_OPTIONS: tuple[tuple[str, str], ...] = (
    ("PLATFORM_BDM_ENABLED", "true"),
    ("PLATFORM_BDM_BASE_URL", "https://bdm.example.invalid"),
    ("PLATFORM_BDM_API_KEY", "no-ai-compose-test-only-value-1234567890"),
    ("PLATFORM_BDM_TIMEZONE", "Asia/Tokyo"),
    ("PLATFORM_BDM_TIMEOUT_S", "11.0"),
    ("PLATFORM_BDM_LOAD_TIMEOUT_S", "121.0"),
    ("PLATFORM_REPORT_SCHEDULE_ENABLED", "true"),
    (
        "PLATFORM_REPORT_API_CONNECTIONS",
        (
            '[{"code":"audit","name":"Audit",'
            '"base_url":"https://reports.example.invalid"}]'
        ),
    ),
    ("PLATFORM_MODELING_GROUP", "no-ai-test-modeling"),
    ("PLATFORM_MODELING_NODE_TIMEOUT_S", "401.0"),
    ("PLATFORM_MODELING_RUN_KEEP_PER_PIPELINE", "27"),
    ("PLATFORM_MODELING_RUN_RETENTION_DAYS", "91"),
    ("PLATFORM_DATASET_ENABLED", "true"),
    ("PLATFORM_DATASET_INTERVAL_S", "65.0"),
    ("PLATFORM_DATASET_RETENTION_ENABLED", "true"),
    ("PLATFORM_DATASET_RETENTION_MAX_ROWS_PER_RUN", "123456"),
)
COLLECT_OPTIONS: tuple[tuple[str, str], ...] = (
    ("COLLECT_HTTP_READ_ENABLED", "true"),
    ("COLLECT_HTTP_ALLOWED_ENDPOINTS", "https://devices.example.invalid"),
    ("COLLECT_HTTP_MAX_CONCURRENT_REQUESTS", "3"),
    ("COLLECT_PLC_READ_ENABLED", "true"),
    ("COLLECT_PLC_ALLOWED_ENDPOINTS", "192.0.2.10:502"),
    ("COLLECT_PLC_MAX_CONCURRENT_REQUESTS", "4"),
    ("COLLECT_ARCHIVE_BATCH_ROWS", "321"),
    ("COLLECT_PLAN_REFRESH_INTERVAL_S", "31.0"),
)


def _read_object(value: object) -> JsonObject:
    """收敛 Compose JSON 对象边界。Args: value。"""
    if not isinstance(value, dict):
        raise TypeError("Compose JSON 字段必须是对象")
    # JSON 解码器保证对象键是字符串，递归值属于 JSON 类型集合。
    return cast(JsonObject, value)


def _read_objects(value: JsonValue) -> list[JsonObject]:
    """读取 Compose 的对象集合。Args: value。"""
    if not isinstance(value, list):
        raise TypeError("Compose JSON 字段必须是数组")
    return [_read_object(item) for item in value]


def _load_environment() -> dict[str, str]:
    """只从示例与固定假值构造测试配置。"""
    environment = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
    }
    for line in TEMPLATE.read_text(encoding="utf-8").splitlines():
        name, separator, value = line.strip().partition("=")
        if separator and re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            environment[name] = (
                value or "no-ai-compose-test-only-value-1234567890"
            )
    return environment


def _render_compose(
    path: Path,
    *,
    profile: str | None = None,
    overrides: Mapping[str, str] | None = None,
    additional_files: tuple[Path, ...] = (),
) -> JsonObject:
    """用隔离环境展开配置，不连接 Docker daemon。

    Args: path, profile, overrides, additional_files。
    """
    command = [
        "docker",
        "compose",
        "--env-file",
        os.devnull,
        "--project-name",
        "no-ai-compose-contract",
        "-f",
        str(path),
    ]
    for additional_file in additional_files:
        command.extend(("-f", str(additional_file)))
    if profile is not None:
        command.extend(("--profile", profile))
    command.extend(("config", "--format", "json"))
    completed = subprocess.run(
        command,
        cwd=ROOT,
        env={**_load_environment(), **(overrides or {})},
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    decoded: object = json.loads(completed.stdout)
    return _read_object(decoded)


def _read_service(config: JsonObject, name: str) -> JsonObject:
    return _read_object(_read_object(config.get("services")).get(name))


def _read_environment(config: JsonObject, name: str) -> JsonObject:
    return _read_object(_read_service(config, name).get("environment"))


def _read_variable_shapes(
    environment: Mapping[str, str],
) -> dict[str, tuple[tuple[str, str], ...]]:
    """归一变量名与嵌套回退表达式。Args: environment。"""
    return {
        name: tuple(
            (item.name, fallback_shape(item.fallback))
            for item in interpolations(value)
        )
        for name, value in environment.items()
        if not name.startswith(AI_PREFIXES)
    }


class NoAiComposeTests(unittest.TestCase):
    """部署配置可以独立审阅且所有非 AI 参数可从模板发现。"""

    def test_compose_does_not_depend_on_another_compose_file(self) -> None:
        source = COMPOSE.read_text(encoding="utf-8")
        assert re.search(r"(?m)^\s*extends\s*:", source) is None

    def test_template_covers_non_ai_deployment_variables(self) -> None:
        source = BASE_COMPOSE.read_text(encoding="utf-8")
        source += COMPOSE.read_text(encoding="utf-8")
        variables = {
            name
            for name in re.findall(r"(?<!\$)\$\{([A-Z][A-Z0-9_]*)", source)
            if not name.startswith(AI_PREFIXES)
        }
        declared = set(
            re.findall(
                r"(?m)^\s*#?\s*([A-Z][A-Z0-9_]*)=",
                TEMPLATE.read_text(encoding="utf-8"),
            )
        )
        assert variables - declared == set()

    def test_template_declares_each_variable_once(self) -> None:
        names = re.findall(
            r"(?m)^\s*#?\s*([A-Z][A-Z0-9_]*)=",
            TEMPLATE.read_text(encoding="utf-8"),
        )
        duplicates = {
            name for name, count in Counter(names).items() if count > 1
        }
        assert not duplicates

    def test_template_explains_each_variable_in_chinese(self) -> None:
        lines = TEMPLATE.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            match = re.match(r"^\s*#?\s*([A-Z][A-Z0-9_]*)=", line)
            if match is None:
                continue
            previous = lines[index - 1].strip() if index else ""
            with self.subTest(variable=match.group(1)):
                assert previous.startswith("#")
                assert re.search(r"[\u4e00-\u9fff]", previous)

    def test_default_services_exclude_ai_and_optional_hierarchy(self) -> None:
        services = _read_object(_render_compose(COMPOSE).get("services"))
        expected = set(BUSINESS_SERVICES) - {"hierarchy-server"}
        expected.update(
            {"postgres", "redis", "minio", "minio-init", "database-migrate"}
        )
        expected.add("edge-gateway")
        assert set(services) == expected

    def test_hierarchy_is_available_only_through_its_profile(self) -> None:
        config = _render_compose(COMPOSE, profile="hierarchy")
        hierarchy = _read_service(config, "hierarchy-server")
        assert hierarchy.get("profiles") == ["hierarchy"]
        assert set(_read_object(config.get("services"))) == set(
            BUSINESS_SERVICES
        ) | {
            "postgres",
            "redis",
            "minio",
            "minio-init",
            "database-migrate",
            "edge-gateway",
        }

    def test_platform_roles_receive_business_configuration(self) -> None:
        config = _render_compose(COMPOSE, overrides=dict(PLATFORM_OPTIONS))
        for service in PLATFORM_ROLES:
            environment = _read_environment(config, service)
            for name, expected in PLATFORM_OPTIONS:
                with self.subTest(service=service, variable=name):
                    assert environment.get(name) == expected

    def test_collector_receives_protocol_and_archive_configuration(
        self,
    ) -> None:
        config = _render_compose(COMPOSE, overrides=dict(COLLECT_OPTIONS))
        environment = _read_environment(config, "collector-server")
        for name, expected in COLLECT_OPTIONS:
            with self.subTest(variable=name):
                assert environment.get(name) == expected

    def test_business_environments_preserve_non_ai_base_semantics(self) -> None:
        original = _render_compose(BASE_COMPOSE, profile="*")
        deployed = _render_compose(COMPOSE, profile="*")
        retained = (
            *BUSINESS_SERVICES,
            "database-migrate",
            "edge-gateway",
            "minio-init",
        )
        for service in retained:
            expected = {
                name: value
                for name, value in _read_environment(original, service).items()
                if not name.startswith(AI_PREFIXES)
            }
            actual = {
                name: value
                for name, value in _read_environment(deployed, service).items()
                if not name.startswith(AI_PREFIXES)
            }
            with self.subTest(service=service):
                assert actual == expected

    def test_business_builds_reuse_the_original_service_images(self) -> None:
        original = _render_compose(BASE_COMPOSE, profile="*")
        deployed = _render_compose(COMPOSE, profile="*")
        for service in (*BUSINESS_SERVICES, "database-migrate"):
            with self.subTest(service=service):
                assert _read_service(deployed, service).get(
                    "build"
                ) == _read_service(original, service).get("build")

    def test_business_variable_names_and_fallbacks_match_the_base(self) -> None:
        original = compose_environments(
            BASE_COMPOSE.read_text(encoding="utf-8")
        )
        deployed = compose_environments(COMPOSE.read_text(encoding="utf-8"))
        retained = (
            *BUSINESS_SERVICES,
            "database-migrate",
            "edge-gateway",
            "minio-init",
        )
        for service in retained:
            with self.subTest(service=service):
                assert _read_variable_shapes(
                    deployed[service]
                ) == _read_variable_shapes(original[service])

    def test_frontend_and_provider_configuration_disable_ai(self) -> None:
        config = _render_compose(
            COMPOSE,
            overrides={
                "LLM_PROVIDER_SECRET": "no-ai-test-provider-value-1234567890",
                "PLATFORM_LLM_PROVIDER_SECRET": (
                    "no-ai-test-provider-value-1234567890"
                ),
            },
        )
        build = _read_object(_read_service(config, "edge-gateway").get("build"))
        assert _read_object(build.get("args"))["VITE_AI_ENABLED"] == "false"
        for service in PLATFORM_ROLES:
            with self.subTest(service=service):
                assert _read_environment(config, service).get(
                    "PLATFORM_LLM_PROVIDER_SECRET"
                ) in (None, "null")

    def test_default_frontend_builds_without_a_host_dist_directory(
        self,
    ) -> None:
        config = _render_compose(
            BASE_COMPOSE, overrides={"IMAGE_TAG": "0.1.0-compose-contract"}
        )
        gateway = _read_service(config, "edge-gateway")
        build = _read_object(gateway.get("build"))
        assert build.get("context") == str(ROOT / "web")
        assert build.get("dockerfile") == "Dockerfile"
        assert _read_object(build.get("args"))["VITE_AI_ENABLED"] == "true"
        assert gateway.get("image") == "digitaltwin/web:0.1.0-compose-contract"
        assert _read_object(gateway.get("sysctls")) == {
            "net.ipv4.ip_unprivileged_port_start": "0"
        }
        mounts = _read_objects(gateway.get("volumes"))
        assert [mount.get("target") for mount in mounts] == [
            "/etc/nginx/templates/nginx.conf.template",
            "/etc/nginx/conf.d/proxy-common.conf",
            "/etc/nginx/conf.d/auth-inject.conf",
        ]
        assert all(mount.get("read_only") is True for mount in mounts)

    def test_host_frontend_mount_requires_explicit_override(self) -> None:
        config = _render_compose(
            BASE_COMPOSE,
            additional_files=(ROOT / "docker" / "compose.web-host.yml",),
        )
        gateway = _read_service(config, "edge-gateway")
        mounts = _read_objects(gateway.get("volumes"))
        html_mounts = [
            mount
            for mount in mounts
            if mount.get("target") == "/usr/share/nginx/html"
        ]
        assert len(html_mounts) == 1
        assert html_mounts[0].get("source") == str(ROOT / "web/app/dist")
        assert html_mounts[0].get("type") == "bind"
        assert html_mounts[0].get("read_only") is True
        original = _read_service(_render_compose(BASE_COMPOSE), "edge-gateway")
        for name in ("build", "image", "depends_on", "environment", "ports"):
            with self.subTest(field=name):
                assert gateway.get(name) == original.get(name)

    def test_migration_selects_all_six_non_ai_owners(self) -> None:
        config = _render_compose(COMPOSE)
        assert _read_service(config, "database-migrate").get("command") == [
            "--service",
            "auth-server",
            "--service",
            "platform-server",
            "--service",
            "opcua-server",
            "--service",
            "collector-server",
            "--service",
            "realtime-hub",
            "--service",
            "hierarchy-server",
        ]

    def test_startup_dependencies_wait_for_initialized_storage(self) -> None:
        config = _render_compose(COMPOSE, profile="hierarchy")
        migration = _read_object(
            _read_service(config, "database-migrate").get("depends_on")
        )
        expected = {
            "postgres": "service_healthy",
            "redis": "service_healthy",
            "minio-init": "service_completed_successfully",
        }
        for name, condition in expected.items():
            assert (
                _read_object(migration.get(name)).get("condition") == condition
            )
        for service in BUSINESS_SERVICES:
            with self.subTest(service=service):
                dependencies = _read_object(
                    _read_service(config, service).get("depends_on")
                )
                assert (
                    _read_object(dependencies.get("database-migrate")).get(
                        "condition"
                    )
                    == "service_completed_successfully"
                )
        initialization = _read_object(
            _read_service(config, "minio-init").get("depends_on")
        )
        assert (
            _read_object(initialization.get("minio")).get("condition")
            == "service_healthy"
        )

    def test_storage_volumes_are_persistent_and_databases_are_internal(
        self,
    ) -> None:
        config = _render_compose(COMPOSE)
        assert set(_read_object(config.get("volumes"))) == {
            "postgres-data",
            "redis-data",
            "minio-data",
            "opcua-pki",
        }
        targets = (
            ("postgres", "postgres-data", "/var/lib/postgresql"),
            ("redis", "redis-data", "/data"),
            ("minio", "minio-data", "/data"),
            ("opcua-server", "opcua-pki", "/var/lib/opcua/pki"),
        )
        for service, source, target in targets:
            mounts = _read_objects(
                _read_service(config, service).get("volumes")
            )
            with self.subTest(service=service):
                assert any(
                    mount.get("source") == source
                    and mount.get("target") == target
                    and mount.get("type") == "volume"
                    for mount in mounts
                )
        for service in ("postgres", "redis"):
            assert not _read_service(config, service).get("ports")
        ports = _read_objects(_read_service(config, "minio").get("ports"))
        assert [port.get("host_ip") for port in ports] == ["127.0.0.1"]

    def test_object_storage_can_build_without_removed_registry_images(
        self,
    ) -> None:
        config = _render_compose(COMPOSE)
        for name, target in (("minio", "server"), ("minio-init", "client")):
            with self.subTest(service=name):
                service = _read_service(config, name)
                build = _read_object(service.get("build"))
                context = build.get("context")
                assert isinstance(context, str)
                assert (Path(context) / "Dockerfile").is_file()
                assert build.get("target") == target
                image = service.get("image")
                assert isinstance(image, str)
                assert image.startswith("digitaltwin/")

    def test_opcua_port_pool_and_frontend_mounts_match_the_deployment(
        self,
    ) -> None:
        config = _render_compose(
            COMPOSE, overrides={"OPCUA_PORT_POOL": "14840-14842"}
        )
        ports = _read_objects(
            _read_service(config, "opcua-server").get("ports")
        )
        assert {
            (port.get("published"), port.get("target")) for port in ports
        } == {("14840", 14840), ("14841", 14841), ("14842", 14842)}
        assert (
            _read_environment(config, "opcua-server").get("OPCUA_PORT_POOL")
            == "14840-14842"
        )
        mounts = _read_objects(
            _read_service(config, "edge-gateway").get("volumes")
        )
        assert "/usr/share/nginx/html" not in [
            mount.get("target") for mount in mounts
        ]


if __name__ == "__main__":
    unittest.main()
