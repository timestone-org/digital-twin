"""二进制产物的四道护栏。

⚠ 这一组是安全用例，不是功能用例：每一条都对应一种「护栏没了会发生什么」。
最要紧的是受限反序列化那条——它防的是**摘要也被一起改掉**的情形，那时候唯一
还站着的就是「这份字节里只准出现这几个模块」。
"""

import hashlib
import os
import pickle
from typing import Any

import numpy as np
import pytest

from platform_server.apps.modeling.services.artifact_store import (
    ARTIFACT_FORMAT_VERSION,
    ArtifactRejected,
    SealedArtifact,
    load,
    model_key,
    run_key,
    run_prefix,
    runtime_versions,
    seal,
)


class Estimator:
    """一个假估计器。⚠ 必须是模块级类，pickle 认不得局部类。"""

    def __init__(self, weight: float) -> None:
        self.weight = weight


class Runner:
    """反序列化时会去调 `os.system` 的一份东西。

    ⚠ 它**不会**真的执行：`find_class` 在名单里找不到 `os` 就先抛了。用例
    证明的正是这一点。
    """

    def __reduce__(self) -> tuple[Any, tuple[str]]:
        """让 pickle 把这份东西还原成一次命令执行。"""
        return (os.system, ("true",))


def _loaded(sealed: SealedArtifact, **overrides: Any) -> Any:
    """按封存件加载，可覆盖其中任意一样用来验护栏。

    Args: sealed, overrides。
    """
    return load(
        sealed.payload,
        digest=overrides.get("digest", sealed.digest),
        format_version=overrides.get("format_version", sealed.format_version),
        runtime=overrides.get("runtime", sealed.runtime),
    )


def _loading(payload: bytes) -> Any:
    """拿一份**自带正确摘要**的字节去加载——只有名单那一道拦得住它。

    Args: payload。
    """
    return load(
        payload,
        digest=hashlib.sha256(payload).hexdigest(),
        format_version=ARTIFACT_FORMAT_VERSION,
        runtime=runtime_versions(),
    )


def test_a_numpy_artifact_round_trips() -> None:
    """封存再加载，拿回来的还是那个东西。"""
    got = _loaded(seal(np.array([1.0, 2.0, 3.0])))
    assert list(got) == [1.0, 2.0, 3.0]


def test_a_tampered_payload_is_refused() -> None:
    """字节被改过就拒载——对象存储被旁路写入等于任意代码执行。"""
    sealed = seal(np.array([1.0]))
    with pytest.raises(ArtifactRejected, match="摘要不符"):
        load(
            sealed.payload + b"x",
            digest=sealed.digest,
            format_version=sealed.format_version,
            runtime=sealed.runtime,
        )


def test_an_older_format_is_refused() -> None:
    """老格式拒载并提示重训，不硬读。"""
    with pytest.raises(ArtifactRejected, match="不被当前代码"):
        _loaded(
            seal(np.array([1.0])),
            format_version=ARTIFACT_FORMAT_VERSION - 1,
        )


def test_a_different_library_version_is_refused() -> None:
    """跨版本加载拒载。

    ⚠ 这是拒载不是告警：放过去的表现是同一个模型换个环境算出不同的数，
    而两边都不报错。
    """
    drifted = {**runtime_versions(), "sklearn": "0.1.0"}
    with pytest.raises(ArtifactRejected, match="跨版本加载不可信"):
        _loaded(seal(np.array([1.0])), runtime=drifted)


def test_a_patch_version_difference_is_fine() -> None:
    """只有补丁号不同不影响反序列化，照常加载。"""
    patched = {
        name: f"{version.rsplit('.', 1)[0]}.999"
        for name, version in runtime_versions().items()
    }
    assert _loaded(seal(np.array([1.0])), runtime=patched) is not None


def test_something_outside_the_whitelist_is_refused() -> None:
    """名单外的类一律拒——哪怕它人畜无害。"""
    payload = pickle.dumps(Estimator(1.0))
    with pytest.raises(ArtifactRejected, match="名单外"):
        _loading(payload)


def test_a_command_execution_payload_never_runs() -> None:
    """一份**真能执行命令**的字节被挡在反序列化之前。

    ⚠ 这条用例真的构造了那条经典利用链（`os.system`），并断言它加载不进来。
    护栏 3 存在的全部理由就是这一条：摘要也被改掉时它是最后一层。
    """
    payload = pickle.dumps(Runner())
    with pytest.raises(ArtifactRejected, match="名单外"):
        _loading(payload)


def test_the_object_keys_are_built_by_the_server() -> None:
    """键由服务端拼，形状固定。

    ⚠ 请求里的任何字符串都不进键——那是护栏 1。
    """
    assert run_key("r1", "n1") == "modeling/runs/r1/n1.pkl"
    assert run_prefix("r1") == "modeling/runs/r1/"
    assert model_key("v1") == "modeling/models/v1/model.pkl"
