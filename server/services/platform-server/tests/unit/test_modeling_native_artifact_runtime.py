"""品牌模型运行库冻结与精确的原生状态容器白名单。"""

from collections import Counter, OrderedDict, defaultdict
from typing import cast

import pytest

from platform_server.apps.modeling.services.artifact_store import (
    ArtifactRejected,
    load,
    runtime_versions,
    seal,
)


def test_defaultdict_round_trips_but_unknown_collections_are_refused() -> None:
    sealed = seal(defaultdict(list, {"training": [1, 2]}))
    restored: object = load(
        sealed.payload,
        digest=sealed.digest,
        format_version=sealed.format_version,
        runtime=sealed.runtime,
    )
    assert isinstance(restored, defaultdict)
    assert restored["training"] == [1, 2]
    rejected = seal(Counter({"training": 1}))
    with pytest.raises(ArtifactRejected, match=r"collections\.Counter"):
        load(
            rejected.payload,
            digest=rejected.digest,
            format_version=rejected.format_version,
            runtime=rejected.runtime,
        )


def test_plain_artifact_omits_unrelated_booster_versions() -> None:
    assert set(runtime_versions()) == {"numpy", "sklearn"}
    assert set(seal({"training": [1, 2]}).runtime) == {"numpy", "sklearn"}


def test_native_ordered_dictionary_preserves_key_order() -> None:
    sealed = seal(OrderedDict([("second", 2), ("first", 1)]))
    restored: object = load(
        sealed.payload,
        digest=sealed.digest,
        format_version=sealed.format_version,
        runtime=sealed.runtime,
    )
    assert isinstance(restored, OrderedDict)
    ordered = cast("OrderedDict[object, object]", restored)
    assert list(ordered) == ["second", "first"]
