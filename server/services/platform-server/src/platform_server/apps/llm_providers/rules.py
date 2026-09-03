"""接入形态与「这一路配了什么」对不对得上，一处判定。

⚠ 写入面（建一路时的 schema 校验）与更新面（改一路时按库里那一格的形态判）
共用这一份。各写一份的结果是：建的时候拦住了、改的时候放过去，而放过去的那一行
在消费方那一侧解不出任何东西，界面上却显示配好了。

⚠ 一律**返回一句话而不是抛**：调用方各自决定这是一条 422 还是一条 400。
"""

from collections.abc import Mapping, Sequence
from typing import Any

from platform_server.apps.llm_providers.enums import (
    DEFAULT_RERANK_DIALECT,
    ProviderKindSpec,
    PurposeSpec,
)

# 推理档位落在这一格里。⚠ 形态之间的键不通用：`options` 的形状由形态说了算
OPTION_DEFAULT_EFFORT = "default_effort"
# 重排线形落在这一格里。⚠ 与 llmcore 的 `OPTION_RERANK_DIALECT` 逐字一致。
# ⚠ 配在**供应商**上而不是模型上：方言说的是「打哪个路径、什么请求体」，
# 它跟着端点走——挂在模型上的话，同一路上配两个重排模型就能配出两套互相
# 矛盾的线形，而只有一套打得通
OPTION_RERANK_DIALECT = "rerank_dialect"

# 每一格配置在报错里叫什么。⚠ 报「配置项 xxx 不对」指不回界面上哪一格
_OPTION_LABELS = {
    OPTION_DEFAULT_EFFORT: "推理档位",
    OPTION_RERANK_DIALECT: "重排线形",
}


def endpoint_mismatch(
    spec: ProviderKindSpec, *, has_base_url: bool, has_api_key: bool
) -> str | None:
    """端点与密钥这两格配得对不对。

    Args: spec, has_base_url, has_api_key。
    """
    if spec.is_endpoint_required:
        if not has_base_url:
            return f"「{spec.label}」要填端点地址"
        if not has_api_key:
            return f"「{spec.label}」要填 API 密钥"
        return None
    if has_base_url or has_api_key:
        return f"「{spec.label}」不填端点与密钥，它靠登录拿令牌"
    return None


def model_kinds_mismatch(
    spec: ProviderKindSpec, kinds: Sequence[str]
) -> str | None:
    """登记的模型种类这一形态吃不吃得下。

    Args: spec, kinds（逐个模型的种类）。
    """
    rejected = next((one for one in kinds if one not in spec.model_kinds), None)
    if rejected is None:
        return None
    return f"「{spec.label}」登记不了{rejected}模型"


def allowed_options(spec: ProviderKindSpec) -> dict[str, tuple[str, ...]]:
    """这一形态认得哪几格配置，各格的取值又限在哪几个里。

    ⚠ 一处算出来、写入面与读出面共用：各写一份的结果是界面上摆得出的那一格
    保存时被拒，而那句话指不回是哪一格多余。

    Args: spec。
    """
    made: dict[str, tuple[str, ...]] = {}
    if spec.efforts:
        made[OPTION_DEFAULT_EFFORT] = spec.efforts
    if spec.rerank_dialects:
        made[OPTION_RERANK_DIALECT] = tuple(
            one.code for one in spec.rerank_dialects
        )
    return made


def options_mismatch(
    spec: ProviderKindSpec, options: Mapping[str, Any] | None
) -> str | None:
    """形态自己那几格配置对不对。

    ⚠ 未登记的键一律拒而不是忽略：忽略掉的那一格在界面上填了、存了、
    读回来还在，唯独没有任何一侧会读它。

    Args: spec, options。
    """
    if not options:
        return None
    allowed = allowed_options(spec)
    if not allowed:
        return f"「{spec.label}」没有可配的选项"
    unknown = next((one for one in options if one not in allowed), None)
    if unknown is not None:
        return f"「{spec.label}」不认识配置项「{unknown}」"
    return next(
        (
            rejected
            for key, values in allowed.items()
            if (rejected := _value_mismatch(options, key, values)) is not None
        ),
        None,
    )


def _value_mismatch(
    options: Mapping[str, Any], key: str, values: tuple[str, ...]
) -> str | None:
    """一格配置的取值在不在闭合集合里；没配这一格就放行。

    Args: options, key, values。
    """
    found = options.get(key)
    if found is None:
        return None
    if not isinstance(found, str) or found not in values:
        return f"{_OPTION_LABELS[key]}只能是 {'/'.join(values)}"
    return None


def shape_mismatch(
    spec: ProviderKindSpec,
    *,
    has_base_url: bool,
    has_api_key: bool,
    model_kinds: Sequence[str],
    options: Mapping[str, Any] | None,
) -> str | None:
    """这一路整体配得对不对；第一条不对就返回，给人一次改一格。

    Args: spec, has_base_url, has_api_key, model_kinds, options。
    """
    return (
        endpoint_mismatch(
            spec, has_base_url=has_base_url, has_api_key=has_api_key
        )
        or model_kinds_mismatch(spec, model_kinds)
        or options_mismatch(spec, options)
    )


def purpose_mismatch(
    spec: ProviderKindSpec, purpose: PurposeSpec
) -> str | None:
    """这一形态接不接得了这个用途。

    ⚠ 消费方那一侧接不了的形态在这里就拦下：放行的话分配写得进去、那一侧
    却仍在用环境变量那一档，而两边代码单看都对。

    Args: spec, purpose。
    """
    if purpose.consumer not in spec.consumers:
        return f"「{spec.label}」这一路{purpose.consumer}那一侧接不了"
    if purpose.kind not in spec.model_kinds:
        return f"「{spec.label}」上没有{purpose.kind}模型这一档"
    return None


def default_effort_of(options: Mapping[str, Any] | None) -> str | None:
    """这一路配的推理档位；没配给 `None`。

    Args: options。
    """
    if not options:
        return None
    found = options.get(OPTION_DEFAULT_EFFORT)
    return found if isinstance(found, str) else None


def rerank_dialect_of(options: Mapping[str, Any] | None) -> str:
    """这一路配的重排线形；没配给默认那一路。

    ⚠ 给默认而不是空串：这一格是后加的，存量的每一路都没有它，而它们打的
    正是默认那一套线形。

    Args: options。
    """
    found = (options or {}).get(OPTION_RERANK_DIALECT)
    return found if isinstance(found, str) and found else DEFAULT_RERANK_DIALECT
