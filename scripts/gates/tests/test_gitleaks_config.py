"""机密扫描默认规则保持启用，文档幂等 nonce 仅按整行与路径联合排除。"""

import re
import tomllib
import unittest
from pathlib import Path
from typing import NotRequired, TypedDict, cast

ROOT = Path(__file__).resolve().parents[3]
DOCUMENT = "docs/MODELING_MANAGEMENT_API.md"
NONCE = "9eb70de7-f8f7-4335-ab2b-b4aee4a5fed8"
HEADER = f"Idempotency-Key: {NONCE}"


class Allowlist(TypedDict, total=False):
    condition: str
    regexTarget: str
    paths: list[str]
    regexes: list[str]


class Rule(TypedDict):
    id: str
    allowlists: list[Allowlist]


class GitleaksConfig(TypedDict):
    extend: dict[str, object]
    rules: list[Rule]
    allowlist: NotRequired[Allowlist]
    allowlists: NotRequired[list[Allowlist]]


def load_config() -> GitleaksConfig:
    # TOML 是动态边界，读取后只使用此处声明的配置结构。
    return cast(
        GitleaksConfig, tomllib.loads((ROOT / ".gitleaks.toml").read_text())
    )


def generic_rule() -> Rule:
    rules = [
        rule
        for rule in load_config()["rules"]
        if rule["id"] == "generic-api-key"
    ]
    assert len(rules) == 1
    return rules[0]


def matches(pattern: str, value: str) -> bool:
    # Go 的行尾锚点要求文本结束，Python 的 $ 另接受终末换行之前。
    expression = pattern[:-1] + r"\Z" if pattern.endswith("$") else pattern
    return re.search(expression, value) is not None


def allows(allowlist: Allowlist, path: str, line: str) -> bool:
    predicates: list[bool] = []
    if paths := allowlist.get("paths"):
        predicates.append(any(matches(pattern, path) for pattern in paths))
    if patterns := allowlist.get("regexes"):
        predicates.append(
            allowlist.get("regexTarget") == "line"
            and any(matches(pattern, line) for pattern in patterns)
        )
    if allowlist.get("condition", "OR").upper() == "AND":
        return bool(predicates) and all(predicates)
    return any(predicates)


def is_generic_excluded(path: str, line: str) -> bool:
    return any(
        allows(allowlist, path, line)
        for allowlist in generic_rule()["allowlists"]
    )


class GitleaksConfigTests(unittest.TestCase):
    """只有指定文档的完整 UUIDv4 幂等头可通过新增例外。"""

    def test_documented_idempotency_nonce_is_not_a_credential(self) -> None:
        nonces = [NONCE, NONCE.upper()]
        nonces.extend(NONCE[:19] + variant + NONCE[20:] for variant in "89ab")
        lines = [
            f"{leading}Idempotency-Key: {nonce}{trailing}"
            for nonce in nonces
            for leading, trailing in (
                ("", ""),
                ("\n", ""),
                ("", "\r"),
                ("\n", "\r"),
            )
        ]
        for line in lines:
            with self.subTest(line=line):
                assert is_generic_excluded(DOCUMENT, line)

    def test_document_exception_requires_path_and_whole_line(self) -> None:
        selected = [
            item
            for item in generic_rule()["allowlists"]
            if allows(item, DOCUMENT, HEADER)
        ]
        assert len(selected) == 1
        assert selected[0].get("condition") == "AND"
        assert selected[0].get("regexTarget") == "line"
        assert selected[0].get("paths")
        assert selected[0].get("regexes")

    def test_same_nonce_under_authentication_headers_is_not_excluded(
        self,
    ) -> None:
        headers = (
            "Authorization: Bearer",
            "Authorization:",
            "API-Key:",
            "X-API-Key:",
            "X-Idempotency-Key:",
            "Idempotency-Keys:",
            "Idempotency-Key-Backup:",
        )
        for header in headers:
            with self.subTest(header=header):
                assert not is_generic_excluded(DOCUMENT, f"{header} {NONCE}")

    def test_same_nonce_outside_exact_document_is_not_excluded(self) -> None:
        paths = (
            "docs/OTHER.md",
            "docs/MODELING_MANAGEMENT_API.md.backup",
            "archive/docs/MODELING_MANAGEMENT_API.md",
            ".env.example",
            "server/services/platform-server/src/platform_server/app.py",
            "web/app/src/main.ts",
        )
        for path in paths:
            with self.subTest(path=path):
                assert not is_generic_excluded(path, HEADER)

    def test_non_uuid_values_quotes_and_trailing_text_are_not_excluded(
        self,
    ) -> None:
        values = (
            f'"{NONCE}"',
            f"'{NONCE}'",
            f"{NONCE} trailing",
            f"{NONCE} # comment",
            NONCE.replace("-", ""),
            NONCE[:-1],
            NONCE + "0",
            "opaque-token-without-a-uuid-shape",
        )
        for value in values:
            with self.subTest(value=value):
                assert not is_generic_excluded(
                    DOCUMENT, f"Idempotency-Key: {value}"
                )
        assert not is_generic_excluded(DOCUMENT, "example " + HEADER)

    def test_other_uuid_versions_and_variants_are_not_excluded(self) -> None:
        nonces = [NONCE[:14] + version + NONCE[15:] for version in "0157"]
        nonces.extend(NONCE[:19] + variant + NONCE[20:] for variant in "07cf")
        for nonce in nonces:
            with self.subTest(nonce=nonce):
                assert not is_generic_excluded(
                    DOCUMENT, f"Idempotency-Key: {nonce}"
                )

    def test_additional_lines_and_header_value_breaks_are_not_excluded(
        self,
    ) -> None:
        lines = (
            "text\n" + HEADER,
            HEADER + "\ntext",
            "\n\n" + HEADER,
            "Idempotency-Key:\n" + NONCE,
            "Idempotency-Key:\r\n" + NONCE,
            HEADER + "\r\ntext",
            HEADER + "\n",
        )
        for line in lines:
            with self.subTest(line=line):
                assert not is_generic_excluded(DOCUMENT, line)

    def test_default_generic_and_provider_rules_remain_enabled(self) -> None:
        config = load_config()
        assert config["extend"]["useDefault"] is True
        assert not config["extend"].get("disabledRules")
        assert not config.get("allowlist")
        assert not config.get("allowlists")
        assert {rule["id"] for rule in config["rules"]} == {"generic-api-key"}
        assert set(generic_rule()) <= {"id", "allowlists"}
