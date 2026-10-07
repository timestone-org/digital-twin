"""配置闸门的回归用例，守住模板覆盖与 Compose 注入语义。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_config_secrets as gate

import _report


class ConfigSecretsTests(unittest.TestCase):
    """用最小仓库复现配置遗漏和跨服务回退分叉。"""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.compose = self.root / "compose.yml"
        self.template = self.root / ".env.template"
        self.example = self.root / ".env.example"
        self.lib = self.root / "lib"
        self.lib.mkdir()
        self.service = self.root / "auth-server"
        source = self.service / "src" / "auth_server"
        source.mkdir(parents=True)
        (self.lib / "base.py").write_text(
            "class DatabaseSettings:\n    postgres_timeout_s: float = 5\n"
            "class BaseSettings(DatabaseSettings):\n"
            "    app_name: str = 'auth-server'\n",
            encoding="utf-8",
        )
        (source / "settings.py").write_text(
            "class Settings(BaseSettings):\n"
            "    jwt_secret: str\n"
            "    model_config = SettingsConfigDict(env_prefix='AUTH_')\n",
            encoding="utf-8",
        )
        patches = (
            patch.object(_report, "ROOT", self.root),
            patch.object(gate, "LIB_ROOT", self.lib),
            patch.object(gate, "COMPOSE", self.compose),
            patch.object(gate, "ROOT_ENV_EXAMPLE", self.example),
            patch.object(gate, "ROOT_ENV_TEMPLATE", self.template, create=True),
            patch.object(gate, "service_dirs", return_value=[self.service]),
        )
        for replacement in patches:
            replacement.start()
            self.addCleanup(replacement.stop)

    def _write_templates(self, content: str) -> None:
        self.template.write_text(content, encoding="utf-8")
        self.example.write_text(content, encoding="utf-8")

    def _write_settings(self, content: str) -> Path:
        path = self.service / "src" / "auth_server" / "settings.py"
        path.write_text(content, encoding="utf-8")
        return path

    def test_secret_defaults_distinguish_constraints_and_numeric_budgets(
        self,
    ) -> None:
        path = self._write_settings(
            "from settings import Field\n"
            "class Settings:\n"
            "    jwt_secret: str\n"
            "    nullable_password: str | None = None\n"
            "    constrained_key: str = Field(min_length=32)\n"
            "    max_input_tokens: int = 128\n"
            "    token_timeout: float | None = 1.5\n"
            "    token_enabled: bool = False\n"
            "    weak_password: str = 'development'\n"
            "    positional_secret: str = Field('development')\n"
            "    named_secret: str = Field(default='development')\n"
            "    factory_secret: str = Field(default_factory=generate)\n"
            "    calculated_secret: str = 'development' + '-key'\n"
            "    optional_key: list[str] = ['development']\n"
            "    holder.secret: str = 'outside-settings-field'\n"
            "    unrelated_name: str = 'safe'\n"
            "    def method(self):\n        return None\n"
        )
        with patch.object(gate, "python_sources", return_value=[path]):
            violations = gate.check_secrets_have_no_default()
        assert {item.detail.split("；")[0] for item in violations} == {
            "weak_password",
            "positional_secret",
            "named_secret",
            "factory_secret",
            "calculated_secret",
            "optional_key",
        }

    def test_unrelated_and_unparseable_sources_do_not_invent_secret_fields(
        self,
    ) -> None:
        unrelated = self.root / "client.py"
        unrelated.write_text(
            "class Client:\n    password: str = 'not-settings'\n",
            encoding="utf-8",
        )
        invalid = self._write_settings("class Settings(:\n")
        with patch.object(
            gate, "python_sources", return_value=[unrelated, invalid]
        ):
            assert gate.check_secrets_have_no_default() == []
            assert gate.check_no_environment_branch() == []

    def test_environment_comparisons_reject_names_and_attributes_only(
        self,
    ) -> None:
        path = self.root / "runtime.py"
        path.write_text(
            "if env == 'prod':\n    pass\n"
            "if settings.environment == 'production':\n    pass\n"
            "if _stage != 'staging':\n    pass\n"
            "if PROFILE == 'DEVELOPMENT':\n    pass\n"
            "if operation == 'production':\n    pass\n"
            "if env == 'canary':\n    pass\n"
            "if env == 1:\n    pass\n"
            "if choose() == 'prod':\n    pass\n",
            encoding="utf-8",
        )
        with patch.object(gate, "python_sources", return_value=[path]):
            violations = gate.check_no_environment_branch()
        assert [item.where for item in violations] == [
            "runtime.py:1",
            "runtime.py:3",
            "runtime.py:5",
            "runtime.py:7",
        ]

    def test_dangerous_defaults_identify_each_security_contract(self) -> None:
        path = self._write_settings(
            "class Settings:\n"
            "    cors_origins: list[str] = ['*']\n"
            "    debug: bool = True\n"
            "    verify: bool = False\n"
            "    auto_create_schema: bool = True\n"
        )
        with patch.object(gate, "python_sources", return_value=[path]):
            violations = gate.check_no_dangerous_defaults()
        assert {item.detail for item in violations} == {
            "CORS 放开全部来源",
            "DEBUG 默认开",
            "TLS 校验默认关",
            "自动建表默认开",
        }
        path.write_text(
            "class Settings:\n"
            "    cors_origins: list[str] = []\n"
            "    debug: bool = False\n"
            "    verify: bool = True\n"
            "    auto_create_schema: bool = False\n",
            encoding="utf-8",
        )
        with patch.object(gate, "python_sources", return_value=[path]):
            assert gate.check_no_dangerous_defaults() == []

    def test_settings_without_prefix_keep_exact_unprefixed_names(
        self,
    ) -> None:
        self._write_settings("class Settings:\n    request_timeout: int = 5\n")
        self._write_templates("# 请求超时。\nREQUEST_TIMEOUT=5\n")
        (self.service / ".env.example").write_text(
            "REQUEST_TIMEOUT=5\n", encoding="utf-8"
        )
        self.compose.write_text(
            "services:\n  auth-server:\n    environment:\n"
            "      REQUEST_TIMEOUT: ${REQUEST_TIMEOUT:-5}\n",
            encoding="utf-8",
        )
        assert gate.check_root_template_lists_every_variable() == []
        assert gate.check_env_example_lists_every_variable() == []
        assert gate.check_compose_passes_every_setting() == []

    def test_cyclic_configuration_inheritance_terminates_and_keeps_fields(
        self,
    ) -> None:
        (self.lib / "base.py").write_text(
            "class First(Second):\n    timeout: int = 5\n"
            "class Second(First):\n    retries: int = 3\n",
            encoding="utf-8",
        )
        (self.lib / "invalid.py").write_text(
            "class Broken(:\n", encoding="utf-8"
        )
        self._write_settings("class Settings(First):\n    pass\n")
        self._write_templates("# 请求超时。\nTIMEOUT=5\n")
        violations = gate.check_root_template_lists_every_variable()
        assert [item.detail for item in violations] == ["RETRIES"]

    def test_services_with_missing_or_unparseable_settings_are_skipped(
        self,
    ) -> None:
        for content in ("class Settings(:\n", None):
            with self.subTest(content=content):
                if content is None:
                    settings = self.service / "src" / "auth_server"
                    (settings / "settings.py").unlink()
                else:
                    self._write_settings(content)
                self.compose.write_text("services:\n", encoding="utf-8")
                assert gate.check_root_template_lists_every_variable() == []
                assert gate.check_env_example_lists_every_variable() == []
                assert gate.check_compose_passes_every_setting() == []

    def test_missing_templates_do_not_duplicate_missing_file_diagnostics(
        self,
    ) -> None:
        assert gate.compose_variables() == {}
        assert gate.check_compose_variables_are_documented() == []
        assert gate.check_root_template_comments() == []
        self._write_templates("# 认证密钥。\nAUTH_JWT_SECRET=\n")
        assert gate.check_root_templates_are_synchronized() == []

    def test_unset_and_empty_required_variables_are_distinct(self) -> None:
        self.compose.write_text(
            "A: ${AUTH_KEY?仅未设置时失败}\n"
            "B: ${AUTH_KEY:?空值也失败}\n"
            "C: ${lowercase}\nD: ${}\n",
            encoding="utf-8",
        )
        violations = gate.check_fallback_chains_are_uniform()
        assert len(violations) == 1
        assert "AUTH_KEY" in violations[0].detail
        assert "必填（未设置）" in violations[0].detail
        assert "必填（空或未设置）" in violations[0].detail

    def test_knowledge_worker_requires_the_same_runtime_inputs(self) -> None:
        knowledge = self.service.rename(self.root / "knowledge-server")
        self.compose.write_text(
            "services:\n  knowledge-server:\n    environment:\n"
            "      AUTH_POSTGRES_TIMEOUT_S: ${AUTH_POSTGRES_TIMEOUT_S:-5}\n"
            "      AUTH_JWT_SECRET: ${AUTH_JWT_SECRET:?必填}\n",
            encoding="utf-8",
        )
        with patch.object(gate, "service_dirs", return_value=[knowledge]):
            violations = gate.check_compose_passes_every_setting()
        assert {item.detail for item in violations} == {
            "AUTH_JWT_SECRET",
            "AUTH_POSTGRES_TIMEOUT_S",
        }
        assert all("knowledge-worker" in item.rule for item in violations)

    def test_nested_fallback_discovers_every_input_and_full_chain(self) -> None:
        self.compose.write_text(
            "A: ${SERVICE_KEY:-${SHARED_KEY:-${ROOT_KEY:?必填}}}\n",
            encoding="utf-8",
        )
        inputs = gate.compose_variables()
        assert set(inputs) == {"SERVICE_KEY", "SHARED_KEY", "ROOT_KEY"}
        assert "ROOT_KEY" in next(iter(inputs["SERVICE_KEY"]))

    def test_different_nested_error_messages_are_equivalent(self) -> None:
        self.compose.write_text(
            "A: ${SERVICE_KEY:-${SHARED_KEY:?第一处说明}}\n"
            "B: ${SERVICE_KEY:-${SHARED_KEY:?第二处说明}}\n",
            encoding="utf-8",
        )
        assert gate.check_fallback_chains_are_uniform() == []

    def test_changed_nested_fallback_cannot_hide_inside_outer_variable(
        self,
    ) -> None:
        self.compose.write_text(
            "A: ${SERVICE_KEY:-${SHARED_KEY:-first}}\n"
            "B: ${SERVICE_KEY:-${SHARED_KEY:-second}}\n",
            encoding="utf-8",
        )
        violations = gate.check_fallback_chains_are_uniform()
        assert len(violations) == 2
        assert any("SERVICE_KEY" in item.detail for item in violations)

    def test_empty_and_unset_fallbacks_are_distinct(self) -> None:
        self.compose.write_text(
            "A: ${SHARED_KEY-default}\nB: ${SHARED_KEY:-default}\n",
            encoding="utf-8",
        )
        assert len(gate.check_fallback_chains_are_uniform()) == 1

    def test_escaped_container_variables_are_not_compose_inputs(self) -> None:
        self.compose.write_text(
            "command: echo $${CONTAINER_NAME}\n", encoding="utf-8"
        )
        assert gate.compose_variables() == {}

    def test_root_template_requires_recursive_settings_fields(self) -> None:
        self._write_templates(
            "# 认证密钥。\nAUTH_JWT_SECRET=\n"
            "# 固定应用名。\n# AUTH_APP_NAME=auth-server\n"
        )
        violations = gate.check_root_template_lists_every_variable()
        assert [item.detail for item in violations] == [
            "AUTH_POSTGRES_TIMEOUT_S"
        ]

    def test_commenting_out_optional_variables_keeps_them_documented(
        self,
    ) -> None:
        self._write_templates(
            "# 数据库请求超时。\n# AUTH_POSTGRES_TIMEOUT_S=5\n"
            "# 固定应用名。\n# AUTH_APP_NAME=auth-server\n"
            "# 认证密钥。\nAUTH_JWT_SECRET=\n"
        )
        assert gate.check_root_template_lists_every_variable() == []
        assert gate.check_root_template_comments() == []

    def test_every_template_variable_requires_adjacent_chinese_comment(
        self,
    ) -> None:
        self._write_templates("# English only\nAUTH_JWT_SECRET=\n")
        assert len(gate.check_root_template_comments()) == 1

    def test_root_templates_must_stay_identical(self) -> None:
        self._write_templates("# 认证密钥。\nAUTH_JWT_SECRET=\n")
        self.example.write_text("AUTH_JWT_SECRET=\n", encoding="utf-8")
        assert len(gate.check_root_templates_are_synchronized()) == 1

    def test_missing_root_templates_are_rejected(self) -> None:
        assert len(gate.check_root_templates_are_synchronized()) == 2

    def test_root_template_covers_nested_compose_inputs_by_exact_name(
        self,
    ) -> None:
        self.compose.write_text(
            "A: ${SERVICE_KEY:-${SHARED_KEY:?必填}}\n", encoding="utf-8"
        )
        self._write_templates(
            "# 服务密钥。\nSERVICE_KEY=\n"
            "# 名称不同的密钥。\nOTHER_SHARED_KEY=\n"
        )
        violations = gate.check_compose_variables_are_documented()
        assert [item.detail for item in violations] == ["SHARED_KEY"]

    def test_service_template_still_covers_recursive_settings(self) -> None:
        (self.service / ".env.example").write_text(
            "# AUTH_POSTGRES_TIMEOUT_S=5\n# AUTH_APP_NAME=auth-server\n",
            encoding="utf-8",
        )
        violations = gate.check_env_example_lists_every_variable()
        assert [item.detail for item in violations] == ["AUTH_JWT_SECRET"]

    def test_compose_requires_input_from_runtime_service_not_migration(
        self,
    ) -> None:
        self.compose.write_text(
            "services:\n"
            "  database-migrate:\n    environment:\n"
            "      AUTH_POSTGRES_TIMEOUT_S: ${AUTH_POSTGRES_TIMEOUT_S:-5}\n"
            "  auth-server:\n    environment:\n"
            "      AUTH_JWT_SECRET: ${AUTH_JWT_SECRET:?必填}\n",
            encoding="utf-8",
        )
        violations = gate.check_compose_passes_every_setting()
        assert [item.detail for item in violations] == [
            "AUTH_POSTGRES_TIMEOUT_S"
        ]

    def test_compose_resolves_environment_anchor_and_role_override(
        self,
    ) -> None:
        self.compose.write_text(
            "x-auth-environment: &auth-environment\n"
            "  AUTH_POSTGRES_TIMEOUT_S: ${AUTH_POSTGRES_TIMEOUT_S:-5}\n"
            "  AUTH_JWT_SECRET: ${AUTH_JWT_SECRET:?必填}\n"
            "  AUTH_APP_NAME: auth-server\n"
            "services:\n  auth-server:\n    environment:\n"
            "      <<: *auth-environment\n",
            encoding="utf-8",
        )
        assert gate.check_compose_passes_every_setting() == []

    def test_hardcoded_tunable_setting_is_rejected(self) -> None:
        self.compose.write_text(
            "services:\n  auth-server:\n    environment:\n"
            "      AUTH_POSTGRES_TIMEOUT_S: 5\n"
            "      AUTH_JWT_SECRET: ${AUTH_JWT_SECRET:?必填}\n",
            encoding="utf-8",
        )
        assert len(gate.check_compose_passes_every_setting()) == 1

    def test_migration_merge_uses_override_without_affecting_runtime(
        self,
    ) -> None:
        self.compose.write_text(
            "x-auth-environment: &auth-environment\n"
            "  AUTH_POSTGRES_TIMEOUT_S: ${AUTH_POSTGRES_TIMEOUT_S:-5}\n"
            "  AUTH_JWT_SECRET: ${AUTH_JWT_SECRET:?必填}\n"
            "  AUTH_POSTGRES_USER: ${POSTGRES_USER:?必填}\n"
            "services:\n  auth-server:\n    environment:\n"
            "      <<: *auth-environment\n"
            "  database-migrate:\n    environment:\n"
            "      <<: *auth-environment\n"
            "      AUTH_POSTGRES_USER: "
            "${MIGRATION_POSTGRES_USER:-${POSTGRES_USER:?必填}}\n",
            encoding="utf-8",
        )
        assert gate.check_compose_passes_every_setting() == []
        assert gate.check_migration_credentials_are_isolated() == []

    def test_every_platform_role_receives_tunable_settings(self) -> None:
        platform = self.service.rename(self.root / "platform-server")
        self.compose.write_text(
            "x-auth-environment: &auth-environment\n"
            "  AUTH_POSTGRES_TIMEOUT_S: ${AUTH_POSTGRES_TIMEOUT_S:-5}\n"
            "  AUTH_JWT_SECRET: ${AUTH_JWT_SECRET:?必填}\n"
            "services:\n  platform-server:\n    environment:\n"
            "      <<: *auth-environment\n"
            "  platform-worker:\n    environment:\n"
            "      <<: *auth-environment\n",
            encoding="utf-8",
        )
        with patch.object(gate, "service_dirs", return_value=[platform]):
            violations = gate.check_compose_passes_every_setting()
        assert len(violations) == 2
        assert all("platform-publisher" in item.rule for item in violations)

    def test_migration_credentials_only_reach_migration_job(self) -> None:
        self.compose.write_text(
            "services:\n  auth-server:\n    environment:\n"
            "      AUTH_POSTGRES_USER: "
            "${MIGRATION_POSTGRES_USER:-${POSTGRES_USER:?必填}}\n",
            encoding="utf-8",
        )
        assert len(gate.check_migration_credentials_are_isolated()) == 1

    def test_migration_credentials_fall_back_to_runtime_credentials(
        self,
    ) -> None:
        self.compose.write_text(
            "services:\n  database-migrate:\n    environment:\n"
            "      USER: ${MIGRATION_POSTGRES_USER:-postgres}\n"
            "      PASSWORD: "
            "${MIGRATION_POSTGRES_PASSWORD:-${POSTGRES_PASSWORD:?必填}}\n",
            encoding="utf-8",
        )
        violations = gate.check_migration_credentials_are_isolated()
        assert len(violations) == 1
        assert "MIGRATION_POSTGRES_USER" in violations[0].detail


if __name__ == "__main__":
    unittest.main()
