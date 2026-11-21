"""Merge asset staging expiration into an exported MinIO lifecycle document."""

import argparse
import json
import sys
from pathlib import Path
from typing import cast

PREFIXES = (
    "staging/model/",
    "staging/image/",
    "staging/icon/",
    "staging/replacements/",
)
RETENTION_DAYS = 7


def _prefix(rule: dict[str, object]) -> str:
    """Read the prefix from a MinIO filter or a legacy rule."""
    filter_spec = rule.get("Filter")
    if isinstance(filter_spec, dict):
        fields = cast(dict[str, object], filter_spec)
        conjunction = fields.get("And")
        if isinstance(conjunction, dict):
            fields = cast(dict[str, object], conjunction)
        prefix = fields.get("Prefix")
    else:
        prefix = rule.get("Prefix")
    return prefix if isinstance(prefix, str) else ""


def merge(document: dict[str, object]) -> dict[str, object]:
    """Add only missing rules and report conflicting existing rules."""
    rules = document.get("Rules")
    if not isinstance(rules, list) or not all(isinstance(rule, dict) for rule in rules):
        raise ValueError("The exported configuration must have a Rules array.")
    existing = cast(list[dict[str, object]], rules)
    merged = list(existing)
    for prefix in PREFIXES:
        rule_id = f"digitaltwin-expire-{prefix.split('/')[1]}-staging"
        settings: dict[str, object] = {
            "Filter": {"Prefix": prefix},
            "Expiration": {"Days": RETENTION_DAYS},
            "Status": "Enabled",
        }
        matches = 0
        for rule in existing:
            if {key: value for key, value in rule.items() if key != "ID"} == settings:
                matches += 1
                continue
            current_prefix = _prefix(rule)
            overlaps = prefix.startswith(current_prefix) or current_prefix.startswith(
                prefix
            )
            if rule.get("ID") == rule_id or (
                rule.get("Status") == "Enabled" and overlaps
            ):
                raise ValueError(
                    f"Existing lifecycle rule {rule.get('ID')!r} conflicts with {prefix}."
                )
        if matches > 1:
            raise ValueError(f"Duplicate expiration rules already cover {prefix}.")
        if matches == 0:
            merged.append({"ID": rule_id, **settings})
    return {**document, "Rules": merged}


def main() -> int:
    """Print merged JSON or check that all four rules already exist."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exported", type=Path, help="MinIO lifecycle export")
    parser.add_argument("--check", action="store_true", help="Require all rules")
    args = parser.parse_args()
    try:
        document: object = json.loads(args.exported.read_text(encoding="utf-8-sig"))
        if not isinstance(document, dict):
            raise TypeError("The lifecycle document must be a JSON object.")
        original = cast(dict[str, object], document)
        combined = merge(original)
        if args.check:
            if combined != original:
                raise ValueError("Asset staging expiration rules are missing.")
        else:
            print(json.dumps(combined, indent=2))
    except (OSError, TypeError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
