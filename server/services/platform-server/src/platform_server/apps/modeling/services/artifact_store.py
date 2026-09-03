"""二进制产物的封存与加载 —— 四道护栏后面才有反序列化。

拟合参数没法用纯 JSON 表达的算法（树模型这一类）走这条通道
（docs/MODELING_PLATFORM_DESIGN.md D9 / D10）。

⚠ 四道护栏一道都不能少：
1. **只加载本服务自己写的字节**——全模块没有任何上传端点，对象键由服务端生成，
   请求里的任何字符串都不进键；
2. **摘要校验先于反序列化**——对象存储被旁路写入就等于任意代码执行；
3. **受限反序列化**——只放行科学计算那几棵模块树，其余一律抛。这是纵深防御：
   护栏 1、2 都被绕过时还剩这一层；
4. **运行时版本必须一致**——跨版本反序列化行为未定义，静默降级的表现是「同一个
   模型换个环境算出不同的数」。

⚠ 拒载一律给人话原因，绝不静默降级成「预测为空」。
"""

import hashlib
import io
import pickle
from dataclasses import dataclass
from typing import Any

import numpy
import sklearn

# 产物的线形版本。序列化的东西换形状就 +1，老产物拒载并提示重训
ARTIFACT_FORMAT_VERSION = 1
# 对象键的两个前缀。⚠ 运行期那份随运行记录一起清，版本那份跟着版本走
RUN_PREFIX = "modeling/runs"
MODEL_PREFIX = "modeling/models"
# 产物的内容类型。存储侧只当字节看，这里给一个明确的
CONTENT_TYPE = "application/octet-stream"

# 受限反序列化的白名单。⚠ 按**模块树**放行，不按类名逐个列：sklearn 一个森林
# 里牵出来的类有几十个，逐个列的下场是升个版本就拒载自己训的模型
_ALLOWED_ROOTS = ("numpy", "scipy", "sklearn", "joblib")
# `builtins` 整棵放行等于把 eval / exec / getattr 一起放进来，只点名这几个
_ALLOWED_BUILTINS = frozenset(
    {
        "bool",
        "bytearray",
        "bytes",
        "complex",
        "dict",
        "float",
        "frozenset",
        "int",
        "list",
        "object",
        "set",
        "slice",
        "str",
        "tuple",
    }
)
# 重建对象时 pickle 自己会用到的那一个
_ALLOWED_COPYREG = frozenset({"_reconstructor"})


class ArtifactRejected(Exception):
    """产物没过护栏。异常信息就是给最终用户看的原因。"""


@dataclass(frozen=True)
class SealedArtifact:
    """封存好、可以直接写进对象存储的一份产物。"""

    payload: bytes
    digest: str
    format_version: int
    runtime: dict[str, str]

    @property
    def size_bytes(self) -> int:
        """字节数，供列表页与配额展示。"""
        return len(self.payload)


def runtime_versions() -> dict[str, str]:
    """当前进程里那几个库的版本。加载前拿它与产物上的比。"""
    return {"numpy": numpy.__version__, "sklearn": sklearn.__version__}


def seal(estimator: object) -> SealedArtifact:
    """封存一个估计器：序列化并盖上摘要与版本。

    Args: estimator。
    """
    payload = pickle.dumps(estimator, protocol=5)
    return SealedArtifact(
        payload=payload,
        digest=hashlib.sha256(payload).hexdigest(),
        format_version=ARTIFACT_FORMAT_VERSION,
        runtime=runtime_versions(),
    )


def meta_of(sealed: SealedArtifact, object_key: str) -> dict[str, Any]:
    """一份产物落库时记的那几样。加载时逐条比对。

    ⚠ 由**训练那一侧**生成：发布跑在 api 进程里，那里的库版本未必与工进程
    一致，到发布时才现算会把跨版本那道拒载闸变成摆设。
    Args: sealed, object_key。
    """
    return {
        "object_key": object_key,
        "digest": sealed.digest,
        "size_bytes": sealed.size_bytes,
        "format_version": sealed.format_version,
        "runtime": dict(sealed.runtime),
    }


def load(
    payload: bytes,
    *,
    digest: str,
    format_version: int,
    runtime: dict[str, str],
) -> Any:
    """过完四道护栏再反序列化。任何一道不过都拒载并说明原因。

    Args: payload, digest, format_version, runtime。
    """
    if hashlib.sha256(payload).hexdigest() != digest:
        raise ArtifactRejected("产物与摘要不符（存储损坏或被改动），请重新训练")
    if format_version != ARTIFACT_FORMAT_VERSION:
        raise ArtifactRejected(
            f"产物格式 v{format_version} 不被当前代码"
            f"（v{ARTIFACT_FORMAT_VERSION}）支持，请重新训练"
        )
    _refuse_version_drift(runtime)
    return _RestrictedUnpickler(io.BytesIO(payload)).load()


def run_key(run_id: str, node_id: str) -> str:
    """一次运行里某个节点的产物键。

    ⚠ 键**由服务端拼**，请求里的任何字符串都不进来（护栏 1）。
    Args: run_id, node_id。
    """
    return f"{RUN_PREFIX}/{run_id}/{node_id}.pkl"


def run_prefix(run_id: str) -> str:
    """一次运行的全部产物前缀，保留期清理按它整片删。

    Args: run_id。
    """
    return f"{RUN_PREFIX}/{run_id}/"


def model_key(version_id: str) -> str:
    """一个模型版本的产物键。

    Args: version_id。
    """
    return f"{MODEL_PREFIX}/{version_id}/model.pkl"


def _refuse_version_drift(runtime: dict[str, str]) -> None:
    """训练时与现在的库版本必须一致（只比大小版本号）。

    ⚠ 这是**拒载**不是告警：跨版本反序列化行为未定义，放过去的表现是同一个
    模型换个环境算出不同的数，而两边都不报错。
    Args: runtime。
    """
    current = runtime_versions()
    for name, trained in sorted(runtime.items()):
        if _minor(trained) != _minor(current.get(name, "")):
            raise ArtifactRejected(
                f"这个产物是用 {name} {trained} 训的，当前环境是 "
                f"{current.get(name, '未知')}，跨版本加载不可信，请重新训练"
            )


def _minor(version: str) -> tuple[str, str]:
    """版本号的前两段。补丁号不同不影响反序列化。

    Args: version。
    """
    parts = version.split(".")
    return (parts[0] if parts else "", parts[1] if len(parts) > 1 else "")


class _RestrictedUnpickler(pickle.Unpickler):
    """只放行科学计算那几棵模块树的反序列化器。

    ⚠ 这一层防的不是「有人改了库里那一行」——那由摘要拦。它防的是**摘要也被
    一起改掉**的情形：那时候唯一还站着的就是「这份字节里只准出现这几个模块」。
    """

    def find_class(self, module: str, name: str) -> Any:
        """按模块树放行；名单外的一律拒。

        Args: module, name。
        """
        if module == "builtins" and name in _ALLOWED_BUILTINS:
            return super().find_class(module, name)
        if module == "copyreg" and name in _ALLOWED_COPYREG:
            return super().find_class(module, name)
        root = module.split(".", maxsplit=1)[0]
        if root in _ALLOWED_ROOTS:
            return super().find_class(module, name)
        raise ArtifactRejected(
            f"产物里出现了名单外的东西（{module}.{name}），拒绝加载"
        )
