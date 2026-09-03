"""一键「注册为公式」：一步建库公式条目 + 建绑定。

用户想要的是「把这个模型当公式用」。在这一步之前他要自己理解三个概念——公式库
条目、形参、按位置映射——而这三个没有一个是他想要的
（docs/MODELING_PLATFORM_DESIGN.md D17）。

⚠ 两件事在**同一个事务**里做完，任一步失败整体回滚：半成品（有条目没绑定）的
表现是台账列报「模型未绑定」，比什么都没建更难排查。
⚠ 形参顺序 = 入口契约的顺序，于是位置映射天然对齐，用户不必理解它。
"""

import re
import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import (
    KEY_PATTERN,
    FormulaCreateIn,
    FormulaDefOut,
    FormulaParamSpec,
    library_service,
)
from platform_server.apps.modeling.errors import ModelVersionUnservable
from platform_server.apps.modeling.models import (
    ModelingBinding,
    ModelingModelVersion,
)
from platform_server.apps.modeling.services import binding_service
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_list,
    as_text,
)
from platform_server.apps.modeling.services.model_schema import entry_keys_of
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.publish_service import (
    require_version,
)

# 公式条目里那种形参。⚠ 只有列形参进得了特征矩阵
PARAM_COLUMN = "column"
_KEY_SHAPE = re.compile(KEY_PATTERN)


@dataclass(frozen=True)
class RegisteredFormula:
    """一键注册的回执：新建的条目与新建的绑定行。

    ⚠ 绑定这一格是 ORM 行不是出参形状：摆成出参要现算「是不是孤儿」，
    而那是 `model_service` 那一层的活——本模块搬过来就成了两份口径。
    """

    formula: FormulaDefOut
    binding: ModelingBinding


async def register_formula(
    session: AsyncSession,
    *,
    version_id: uuid.UUID,
    fx_code: str,
    actor: Actor,
) -> RegisteredFormula:
    """把一个模型版本注册成一条库公式，并当场绑上。

    ⚠ `fx_code` 已存在时**不覆盖**，由建条目那一步 409。静默覆盖一条别人在用
    的公式是不可逆的。
    Args: session, version_id, fx_code, actor。
    """
    version = await require_version(session, version_id)
    if not version.servable:
        raise ModelVersionUnservable(
            version.unservable_reason or "这个模型版本不可上线"
        )
    params = param_names_of(version)
    formula = await library_service.create_formula(
        session,
        payload=FormulaCreateIn(
            code=fx_code,
            name=version.name,
            expression=expression_of(fx_code, params),
            params=[
                FormulaParamSpec(name=name, kind=PARAM_COLUMN)
                for name in params
            ],
            description=f"由模型「{version.name}」第 {version.version} 版计算",
        ),
    )
    binding = await binding_service.create_binding(
        session,
        draft=binding_service.BindingDraft(
            fx_code=fx_code, model_version_id=version.id
        ),
        actor=actor,
    )
    return RegisteredFormula(formula=formula, binding=binding)


def expression_of(fx_code: str, params: list[str]) -> str:
    """这条条目的公式体。

    ⚠ 标识用单引号包起来：它可能含中文与连字符，裸着写解析不出来。
    Args: fx_code, params。
    """
    slots = ", ".join(f"{{{name}}}" for name in params)
    return f"PREDICT('{fx_code}', {slots})"


def param_names_of(version: ModelingModelVersion) -> list[str]:
    """形参名，**按入口契约的顺序**。

    ⚠ 顺序就是契约：绑定按位置把形参落到入口列上，顺序错了不报错，只是算出
    别的数（D5）。
    ⚠ 名字优先取台账列的显示名，落不进形参名的字符集时退回列 key——显示名可能
    含空格或括号，而那些在形参名里是非法字符。
    Args: version。
    """
    signature = dict(version.signature_json)
    keys = entry_keys_of(
        signature, [str(item) for item in version.feature_keys]
    )
    labels = _labels_of(signature)
    chosen = [_named(key, labels.get(key, "")) for key in keys]
    return _deduplicated(chosen, keys)


def _labels_of(signature: dict[str, object]) -> dict[str, str]:
    """入口列的显示名，按列 key 建键。

    Args: signature。
    """
    found: dict[str, str] = {}
    for item in as_list(signature.get("inputs")):
        column = as_dict(item)
        found[as_text(column.get("key"))] = as_text(column.get("label"))
    return found


def _named(key: str, label: str) -> str:
    """这一列的形参名。

    Args: key, label。
    """
    return label if label and _KEY_SHAPE.match(label) else key


def _deduplicated(chosen: list[str], keys: list[str]) -> list[str]:
    """重名的那些退回列 key。

    ⚠ 重名不能放过：形参名是条目上的唯一标识，两个同名形参会让调用点上的
    第二个位置永远拿不到值。
    Args: chosen, keys。
    """
    seen: dict[str, int] = {}
    for name in chosen:
        seen[name] = seen.get(name, 0) + 1
    return [
        key if seen[name] > 1 else name
        for name, key in zip(chosen, keys, strict=True)
    ]
