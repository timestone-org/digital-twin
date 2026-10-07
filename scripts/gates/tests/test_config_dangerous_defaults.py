"""危险配置默认值按真实 AST 绑定与 Field 默认值判断。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_config_secrets as gate

import _report


class DangerousDefaultsTests(unittest.TestCase):
    """注解、Field 与容器写法共享同一安全判据。"""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        replacement = patch.object(_report, "ROOT", self.root)
        replacement.start()
        self.addCleanup(replacement.stop)

    def _check_source(self, source: str) -> list[_report.Violation]:
        path = self.root / "policy.py"
        path.write_text(source + "\n", encoding="utf-8")
        with patch.object(gate, "python_sources", return_value=[path]):
            return gate.check_no_dangerous_defaults()

    def test_annotated_boolean_defaults_are_dangerous(self) -> None:
        found = self._check_source(
            "verify: Annotated[bool, 'TLS verification'] = False"
        )
        assert [item.detail for item in found] == ["TLS 校验默认关"]

    def test_union_boolean_defaults_are_dangerous(self) -> None:
        found = self._check_source("debug: bool | None = True")
        assert [item.detail for item in found] == ["DEBUG 默认开"]

    def test_imported_field_alias_preserves_default_semantics(self) -> None:
        sources = (
            "from pydantic import Field as F\nverify: bool = F(default=False)",
            "import pydantic as validation\ndebug = validation.Field(True)",
        )
        for source in sources:
            with self.subTest(source=source):
                assert self._check_source(source)

    def test_literal_factory_defaults_are_dangerous(self) -> None:
        found = self._check_source(
            "verify: bool = Field(default_factory=lambda: False)"
        )
        assert [item.detail for item in found] == ["TLS 校验默认关"]

    def test_dictionary_configuration_keys_are_dangerous(self) -> None:
        found = self._check_source(
            "settings = {'verify': False, 'debug': True, "
            "'auto_create_tables': True, 'cors_origins': ['*']}"
        )
        assert {item.detail for item in found} == {
            "TLS 校验默认关",
            "DEBUG 默认开",
            "自动建表默认开",
            "CORS 放开全部来源",
        }

    def test_historical_state_names_do_not_configure_security(self) -> None:
        sources = (
            "previous_debug = True",
            "def snapshot():\n    previous_debug = True\n"
            "    return previous_debug",
            "class History:\n    previous_debug: bool = True",
            "history = {'previous_debug': True, 'previous_verify': False}",
            "record(previous_debug=True, previous_verify=False)",
            "old = False\ndebugging = True\nverify_result = False",
        )
        for source in sources:
            with self.subTest(source=source):
                assert self._check_source(source) == []

    def test_configuration_names_keep_their_security_semantics(self) -> None:
        sources = (
            "app_debug = True",
            "tls_verify = False",
            "db_auto_create_tables = True",
            "settings.debug = True",
            "options = {'TLS_VERIFY': False}",
        )
        for source in sources:
            with self.subTest(source=source):
                assert self._check_source(source)

    def test_safe_field_defaults_and_factory_data_stay_safe(self) -> None:
        assert (
            self._check_source(
                "from pydantic import Field as F\n"
                "verify: Annotated[bool, 'TLS'] = F(default=True)\n"
                "debug: bool | None = Field(default_factory=lambda: False)\n"
                "auto_create_tables = Field(default=False)\n"
                "cors_origins = Field(default_factory=lambda: [])\n"
                "unrelated = Field(default_factory=lambda: False)\n"
                "description = {'code': 'verify: bool = False'}\n"
                "settings = {'debug': 'True', 'verify': 'False'}\n"
                "cors_origins = ['documentation*snippet']"
            )
            == []
        )

    def test_tuple_and_subscript_bindings_preserve_security_names(self) -> None:
        found = self._check_source(
            "debug, verify = True, False\n"
            "settings['auto_create_tables'] = True\n"
            "settings['cors_origins'] = ['*']"
        )
        assert {item.detail for item in found} == {
            "DEBUG 默认开",
            "TLS 校验默认关",
            "自动建表默认开",
            "CORS 放开全部来源",
        }


if __name__ == "__main__":
    unittest.main()
