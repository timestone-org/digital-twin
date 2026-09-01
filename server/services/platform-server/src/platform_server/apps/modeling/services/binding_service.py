"""模型版本与公式条目的绑定。

⚠ 形参 → 特征列**按位置**映射，不按名字：调用点写的是台账列名、形参名是公式
条目上的标签、特征名是训练时的列 key，三者可以完全不同（同一个模型可能被两张
台账用）。位置是唯一在三者之间稳定的东西，名字只用于展示与二次确认
（docs/MODELING_DESIGN.md §7.4）。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import formula_library
from platform_server.apps.modeling.crud import binding_crud
from platform_server.apps.modeling.errors import (
    BindingCodeTaken,
    BindingNotFound,
    BindingParamsMismatch,
    ModelVersionInUse,
    ModelVersionUnservable,
)
from platform_server.apps.modeling.models import ModelingBinding
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.publish_service import (
    require_version,
)

# 只有列形参进得了特征矩阵：值形参是一个表达式的位置，不是一列数
PARAM_COLUMN = "column"


@dataclass(frozen=True)
class BindingDraft:
    """建一条绑定要的两样。"""

    fx_code: str
    model_version_id: uuid.UUID


async def create_binding(
    session: AsyncSession, *, draft: BindingDraft, actor: Actor
) -> ModelingBinding:
    """把一个模型版本绑到一条公式条目上。

    Args: session, draft, actor。
    """
    if await binding_crud.get_by_code(session, draft.fx_code) is not None:
        raise BindingCodeTaken("这条公式条目已经绑过一个模型版本了")
    version = await require_version(session, draft.model_version_id)
    if not version.servable:
        raise ModelVersionUnservable(
            version.unservable_reason or "这个模型版本不可上线"
        )
    params = await _column_params(session, draft.fx_code)
    features = [str(key) for key in version.feature_keys]
    _require_same_arity(params, features)
    row = binding_crud.add(
        session,
        ModelingBinding(
            fx_code=draft.fx_code,
            model_version_id=version.id,
            param_map_json=[
                {"param": name, "feature": feature}
                for name, feature in zip(params, features, strict=True)
            ],
            param_names_snapshot=list(params),
            is_enabled=True,
            created_by=actor.user_id,
            created_by_name=actor.name,
        ),
    )
    await session.flush()
    return row


async def rebind(
    session: AsyncSession, *, binding_id: uuid.UUID, version_id: uuid.UUID
) -> ModelingBinding:
    """把一条绑定换到另一个版本上。

    ⚠ 换版本之后，引用这条公式的台账**要重算才会按新版本出数**——重算是
    `dataset:backfill` 档位的动作，不在这里顺带做（§7.7）。
    Args: session, binding_id, version_id。
    """
    row = await require_binding(session, binding_id)
    version = await require_version(session, version_id)
    if not version.servable:
        raise ModelVersionUnservable(
            version.unservable_reason or "这个模型版本不可上线"
        )
    params = [str(name) for name in row.param_names_snapshot]
    _require_same_arity(params, [str(key) for key in version.feature_keys])
    row.model_version_id = version.id
    await session.flush()
    return row


async def set_enabled(
    session: AsyncSession, *, binding_id: uuid.UUID, is_enabled: bool
) -> ModelingBinding:
    """启停一条绑定。停用之后那一列变空，并给一句「模型绑定已停用」。

    Args: session, binding_id, is_enabled。
    """
    row = await require_binding(session, binding_id)
    row.is_enabled = is_enabled
    await session.flush()
    return row


async def delete_binding(session: AsyncSession, binding_id: uuid.UUID) -> None:
    """删一条绑定。

    Args: session, binding_id。
    """
    row = await require_binding(session, binding_id)
    await binding_crud.delete(session, row)


async def require_binding(
    session: AsyncSession, binding_id: uuid.UUID
) -> ModelingBinding:
    """取绑定，取不到即 404。

    Args: session, binding_id。
    """
    row = await binding_crud.get(session, binding_id)
    if row is None:
        raise BindingNotFound("绑定不存在")
    return row


async def require_retirable(
    session: AsyncSession, version_id: uuid.UUID
) -> None:
    """退役一个版本之前，确认没有绑定还指着它。

    Args: session, version_id。
    """
    if await binding_crud.count_of_version(session, version_id):
        raise ModelVersionInUse("还有绑定指着这个版本，请先解绑")


async def _column_params(
    session: AsyncSession, fx_code: str
) -> tuple[str, ...]:
    """公式条目上那些**列形参**的名字，按声明序。

    ⚠ 条目不存在或含值形参时明说：值形参进不了特征矩阵，而放行它的后果是
    实参位置整体错位、算出一批像模像样的错数。
    Args: session, fx_code。
    """
    library = await formula_library.load_library(session)
    entry = library.entries.get(fx_code)
    if entry is None:
        raise BindingParamsMismatch("公式库里没有这条条目")
    if any(param.kind != PARAM_COLUMN for param in entry.params):
        raise BindingParamsMismatch(
            "这条公式条目上有非列形参，进不了模型的特征矩阵"
        )
    return tuple(param.name for param in entry.params)


def _require_same_arity(params: Sequence[str], features: Sequence[str]) -> None:
    if len(params) != len(features):
        raise BindingParamsMismatch(
            f"公式条目有 {len(params)} 个形参，"
            f"模型要 {len(features)} 个特征，对不上"
        )
