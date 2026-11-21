"""素材暂存到期合并保留现有生命周期规则。"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

_REPOSITORY = Path(__file__).resolve().parents[3]
_MERGE_SCRIPT = _REPOSITORY / "docker/minio/merge_staging_lifecycle.py"
_ARCHIVE = {
    "ID": "separate-archive",
    "Filter": {"Prefix": "archive/"},
    "Status": "Enabled",
    "Expiration": {"Days": 45},
}


def test_merge_preserves_other_rules_and_is_idempotent(tmp_path: Path) -> None:
    exported = tmp_path / "lifecycle.json"
    exported.write_text(json.dumps({"Rules": [_ARCHIVE]}))
    command = [sys.executable, str(_MERGE_SCRIPT), str(exported)]
    result = subprocess.check_output(command, text=True, timeout=5)
    rules = json.loads(result)["Rules"]
    assert rules[0] == _ARCHIVE
    assert len(rules) == 5
    assert {rule["Filter"]["Prefix"] for rule in rules[1:]} == {
        "staging/model/",
        "staging/image/",
        "staging/icon/",
        "staging/replacements/",
    }
    assert all(rule["Expiration"] == {"Days": 7} for rule in rules[1:])

    exported.write_text(result)
    assert subprocess.check_output(command, text=True, timeout=5) == result
    subprocess.run([*command, "--check"], check=True, timeout=5)


@pytest.mark.parametrize(
    "rule",
    [
        {**_ARCHIVE, "Filter": {"Prefix": "staging/"}},
        {**_ARCHIVE, "Filter": {"And": {"Prefix": "staging/model/"}}},
        {**_ARCHIVE, "ID": "digitaltwin-expire-model-staging"},
    ],
    ids=["broader-prefix", "nested-filter", "reserved-id"],
)
def test_merge_refuses_conflicting_existing_rules(
    tmp_path: Path, rule: dict[str, object]
) -> None:
    exported = tmp_path / "lifecycle.json"
    original = json.dumps({"Rules": [rule]})
    exported.write_text(original)
    result = subprocess.run(
        [sys.executable, str(_MERGE_SCRIPT), str(exported)],
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    assert result.returncode == 1
    assert "conflicts with" in result.stderr
    assert not result.stdout
    assert exported.read_text() == original
