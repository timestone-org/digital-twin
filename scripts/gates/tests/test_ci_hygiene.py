"""镜像版本闸区分外部镜像与 Dockerfile 的本地构建阶段。"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_ci_hygiene as gate

import _report


class ImagePinningTests(unittest.TestCase):
    """构建平台选项、阶段别名与镜像版本的判定。"""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        replacements = (
            patch.object(_report, "ROOT", self.root),
            patch.object(gate, "_workflows", return_value=[]),
            patch.object(gate, "_compose_files", return_value=[]),
        )
        for replacement in replacements:
            replacement.start()
            self.addCleanup(replacement.stop)

    def _check(self, source: str) -> list[_report.Violation]:
        path = self.root / "Dockerfile"
        path.write_text(source, encoding="utf-8")
        with patch.object(gate, "_dockerfiles", return_value=[path]):
            return gate.check_no_latest_tag()

    def test_pinned_images_accept_platform_options(self) -> None:
        assert (
            self._check(
                "FROM --platform=$BUILDPLATFORM golang:1.27.3 AS go-builder\n"
                "FROM --platform=linux/amd64 alpine:3.22 AS runtime\n"
            )
            == []
        )

    def test_declared_stages_can_be_used_as_base_images(self) -> None:
        assert (
            self._check(
                "FROM golang:1.27.3 AS go-builder\n"
                "FROM go-builder AS compile\n"
                "FROM alpine:3.22 AS runtime\n"
                "FROM runtime\n"
            )
            == []
        )

    def test_stage_keywords_and_references_are_case_insensitive(self) -> None:
        assert (
            self._check(
                "from --platform=$BUILDPLATFORM golang:1.27.3 as Builder\n"
                "FROM --platform=linux/amd64 builder\n"
            )
            == []
        )

    def test_platform_options_do_not_hide_unpinned_external_images(
        self,
    ) -> None:
        violations = self._check(
            "FROM --platform=$BUILDPLATFORM golang:latest AS go-builder\n"
            "FROM --platform=linux/amd64 alpine\n"
        )
        assert [item.detail for item in violations] == [
            "golang:latest",
            "alpine",
        ]

    def test_alias_does_not_pin_its_own_unpinned_image(self) -> None:
        violations = self._check("FROM alpine AS alpine\nFROM alpine\n")
        assert [item.detail for item in violations] == ["alpine"]

    def test_alias_must_be_declared_before_use(self) -> None:
        violations = self._check("FROM runtime\nFROM alpine:3.22 AS runtime\n")
        assert [item.detail for item in violations] == ["runtime"]

    def test_stage_aliases_are_scoped_to_their_dockerfile(self) -> None:
        first = self.root / "Dockerfile.first"
        first.write_text("FROM alpine:3.22 AS runtime\n", encoding="utf-8")
        second = self.root / "Dockerfile.second"
        second.write_text("FROM runtime\n", encoding="utf-8")
        with patch.object(gate, "_dockerfiles", return_value=[first, second]):
            violations = gate.check_no_latest_tag()
        assert [item.where for item in violations] == ["Dockerfile.second:1"]

    def test_tagged_stage_name_still_denotes_an_external_image(self) -> None:
        violations = self._check(
            "FROM alpine:3.22 AS runtime\nFROM runtime:latest\n"
        )
        assert [item.detail for item in violations] == ["runtime:latest"]

    def test_digest_does_not_allow_a_latest_tag(self) -> None:
        digest = "a" * 64
        violations = self._check(
            f"FROM --platform=$BUILDPLATFORM alpine:latest@sha256:{digest}\n"
        )
        assert [item.detail for item in violations] == ["alpine:latest"]

    def test_yaml_images_keep_version_and_latest_checks(self) -> None:
        path = self.root / "compose.yml"
        path.write_text(
            "services:\n"
            "  stable:\n    image: redis:8.10.3-alpine\n"
            "  moving:\n    image: redis:latest\n"
            "  unversioned:\n    image: redis\n",
            encoding="utf-8",
        )
        with (
            patch.object(gate, "_dockerfiles", return_value=[]),
            patch.object(gate, "_compose_files", return_value=[path]),
        ):
            violations = gate.check_no_latest_tag()
        assert [item.detail for item in violations] == ["redis:latest", "redis"]


if __name__ == "__main__":
    unittest.main()
