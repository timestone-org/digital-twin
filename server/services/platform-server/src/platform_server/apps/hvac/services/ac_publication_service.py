"""发布配置的写侧与读侧：绑点位、解绑、看绑成了什么样。

事务边界在这一层，crud 不提交。真正的下发在 `ac_publish_service`。
口径见 docs/AC_PUBLISH_DESIGN.md §3、§8。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.hvac.crud import (
    ac_model_crud,
    ac_model_publication_crud,
    ac_model_set_binding_crud,
)
from platform_server.apps.hvac.errors import (
    OpcuaUnavailable,
    PublicationBindingInvalid,
    PublicationNodeTaken,
    PublicationNotFound,
)
from platform_server.apps.hvac.modeling.evaluation import set_key
from platform_server.apps.hvac.models import (
    AcModel,
    AcModelPublication,
    AcModelSetBinding,
)
from platform_server.apps.hvac.publications import (
    DURATION_DATA_TYPES,
    RECOMMENDATION_DATA_TYPE,
)
from platform_server.apps.hvac.schemas import PublicationPutIn, SetBindingIn
from platform_server.apps.hvac.services import ac_model_service
from platform_server.opcua import NodeWriter, OpcuaCallFailed, ResolvedNode

_logger = get_logger("platform.hvac.ac_publication")


@dataclass(frozen=True)
class PublicationView:
    """一份发布配置连同判定「绑齐没有」所需的全部事实。

    ⚠ `room_id` 在这里带出来而不是让调用方回查模型：下发时要用它取实时读数，
    而那一步跑在事务之外。
    """

    publication: AcModelPublication
    bindings: list[AcModelSetBinding]
    serving_keys: tuple[str, ...]
    room_id: uuid.UUID

    @property
    def bound_keys(self) -> frozenset[str]:
        """已经绑了点位的那些组合。"""
        return frozenset(binding.set_key for binding in self.bindings)

    @property
    def unbound_set_keys(self) -> list[str]:
        """服务组合里还没绑点位的那些，升序。"""
        return sorted(set(self.serving_keys) - self.bound_keys)

    @property
    def is_fully_bound(self) -> bool:
        """实例 + 区域点位 + 每一个服务组合都绑齐了。

        ⚠ 空的服务组合不算绑齐：一个组合都没有的模型没什么可下发的，
        判成「绑齐」会让它每分钟写一次区域点位而底下一个数都没有。
        """
        return (
            self.publication.recommendation_node_id is not None
            and bool(self.serving_keys)
            and not self.unbound_set_keys
        )


async def get_view(
    session: AsyncSession, model_id: uuid.UUID
) -> PublicationView:
    """取一个模型的发布配置；没配过就抛。

    Args: session, model_id。
    """
    model = await ac_model_service.get_model(session, model_id)
    found = await ac_model_publication_crud.find(session, model_id)
    if found is None:
        raise PublicationNotFound("这个模型还没有配过预测下发")
    return PublicationView(
        publication=found,
        bindings=await ac_model_set_binding_crud.list_of_model(
            session, model_id
        ),
        serving_keys=serving_keys_of(model),
        room_id=model.room_id,
    )


def serving_keys_of(model: AcModel) -> tuple[str, ...]:
    """模型的服务组合的 `set_key`，升序去重。

    Args: model。
    """
    return tuple(sorted({set_key(serving) for serving in model.serving_sets}))


@dataclass(frozen=True)
class SkippedModel:
    """已启用但发不出去的一个模型，连同为什么。"""

    model_id: uuid.UUID
    reason: str


@dataclass(frozen=True)
class DueModels:
    """这一拍该发的与该跳过的。

    ⚠ 跳过的必须带出来单独记一条日志：跳过与发布成功混成一条 event 的话，
    一个从来没发布过的模型在日志里与正常发布的一模一样。
    """

    ready: tuple[uuid.UUID, ...]
    skipped: tuple[SkippedModel, ...]


async def due_models(session: AsyncSession) -> DueModels:
    """这一拍要发哪些模型。

    ⚠ 一次把三张表取全，不逐个模型回查：发布循环每分钟跑一次，N+1 在这里
    就是每分钟 N 次往返。

    Args: session。
    """
    rows = await ac_model_publication_crud.list_enabled(session)
    model_ids = [row.model_id for row in rows]
    keys = {
        model.id: serving_keys_of(model)
        for model in await ac_model_crud.list_by_ids(session, model_ids)
    }
    bindings = await ac_model_set_binding_crud.list_of_models(
        session, model_ids
    )
    bound: dict[uuid.UUID, set[str]] = {}
    for binding in bindings:
        bound.setdefault(binding.model_id, set()).add(binding.set_key)
    ready: list[uuid.UUID] = []
    skipped: list[SkippedModel] = []
    for row in rows:
        reason = _skip_reason(row, keys.get(row.model_id), bound)
        if reason is None:
            ready.append(row.model_id)
        else:
            skipped.append(SkippedModel(model_id=row.model_id, reason=reason))
    return DueModels(ready=tuple(ready), skipped=tuple(skipped))


def _skip_reason(
    row: AcModelPublication,
    serving: tuple[str, ...] | None,
    bound: dict[uuid.UUID, set[str]],
) -> str | None:
    """这个模型这一拍发不出去的原因；发得出去给 None。

    Args: row, serving, bound。
    """
    if serving is None:
        return "模型已不存在"
    if row.recommendation_node_id is None:
        return "区域推荐点位还没绑"
    if not serving:
        return "模型没有服务组合"
    missing = sorted(set(serving) - bound.get(row.model_id, set()))
    if missing:
        return f"这些组合还没绑点位：{'、'.join(missing)}"
    return None


async def put_publication(
    session: AsyncSession,
    nodes: NodeWriter,
    *,
    model_id: uuid.UUID,
    payload: PublicationPutIn,
) -> PublicationView:
    """整份保存发布配置。

    ⚠ 整份保存不是补丁：换了实例，底下每一个 node_id 都得跟着换，逐字段
    PATCH 会让中间态出现「节点属于旧实例」，而那个中间态每分钟往现场写一次。

    Args: session, nodes, model_id, payload。
    """
    model = await ac_model_service.get_model(session, model_id)
    _require_known_sets(payload.set_bindings, serving_keys_of(model))
    _require_distinct_nodes(payload)
    found = await _require_bindable(nodes, payload=payload)
    return await _save(session, model=model, payload=payload, found=found)


def _require_known_sets(
    bindings: Sequence[SetBindingIn], keys: tuple[str, ...]
) -> None:
    """绑的组合必须是这个模型的服务组合，且不重复。

    ⚠ 绑一个不在服务组合里的键不会有任何后果——它永远不会被写——所以必须
    当场拒绝，而不是存下来让人以为绑上了。

    Args: bindings, keys。
    """
    asked = [binding.set_key for binding in bindings]
    if len(asked) != len(set(asked)):
        raise PublicationBindingInvalid("同一个组合绑了不止一个点位")
    unknown = sorted(set(asked) - set(keys))
    if unknown:
        raise PublicationBindingInvalid(
            f"这些组合不在模型的服务组合里：{'、'.join(unknown)}"
        )


def _require_distinct_nodes(payload: PublicationPutIn) -> None:
    """一份配置里同一个点位不许出现两次。

    ⚠ 库里那两条唯一约束挡的是「跨模型」的双写，同一份配置内部的重复要在
    这里挡：它落库时会撞上同一条约束，但报出来的原因会指向别的模型。

    Args: payload。
    """
    asked = [binding.node_id for binding in payload.set_bindings]
    if payload.recommendation_node_id is not None:
        asked.append(payload.recommendation_node_id)
    if len(asked) != len(set(asked)):
        raise PublicationBindingInvalid("同一个点位被绑给了不止一处")


async def _require_bindable(
    nodes: NodeWriter, *, payload: PublicationPutIn
) -> dict[uuid.UUID, ResolvedNode]:
    """问一遍 opcua-server：这些节点还在不在、类型对不对、可不可写。

    返回解析结果，落库时拿它填标识快照。

    ⚠ 在**绑定的那一刻**问，不是等到每分钟写值时才发现「这个点位是 boolean，
    塞不进分钟数」——那是每分钟发现一次、永远发现下去。

    Args: nodes, payload。
    """
    wanted = [binding.node_id for binding in payload.set_bindings]
    if payload.recommendation_node_id is not None:
        wanted.append(payload.recommendation_node_id)
    if not wanted:
        return {}
    found = await _resolve(
        nodes, instance_id=payload.opcua_instance_id, node_ids=wanted
    )
    for binding in payload.set_bindings:
        _require_type(
            found.get(binding.node_id),
            allowed=DURATION_DATA_TYPES,
            what=f"组合 {binding.set_key} 的预测时间点位",
        )
    if payload.recommendation_node_id is not None:
        _require_type(
            found.get(payload.recommendation_node_id),
            allowed=frozenset({RECOMMENDATION_DATA_TYPE}),
            what="区域推荐点位",
        )
    return found


async def _resolve(
    nodes: NodeWriter,
    *,
    instance_id: uuid.UUID,
    node_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, ResolvedNode]:
    """打 opcua-server 解析一批节点；打不通就抛，不放行。

    ⚠ 问不到却照样保存，等于把一份没校验过的配置存下来——而它看起来与校验过
    的一模一样。

    Args: nodes, instance_id, node_ids。
    """
    try:
        resolved = await nodes.resolve(
            instance_id=instance_id, node_ids=node_ids
        )
    except OpcuaCallFailed as error:
        raise OpcuaUnavailable(f"校验点位时{error}，请稍后重试") from error
    return {item.id: item for item in resolved}


def _require_type(
    found: ResolvedNode | None, *, allowed: frozenset[str], what: str
) -> None:
    """一个节点必须存在、类型在允许集合里、且可写。

    Args: found, allowed, what。
    """
    if found is None or not found.is_found:
        raise PublicationBindingInvalid(f"{what}在这台实例上不存在")
    if found.data_type not in allowed:
        expected = "、".join(sorted(allowed))
        raise PublicationBindingInvalid(
            f"{what}的数据类型是 {found.data_type}，只能绑 {expected}"
        )
    # ⚠ 不可写的节点绑上去就是每分钟失败一次：AccessLevel 少了 CurrentWrite 位
    if not found.is_writable:
        raise PublicationBindingInvalid(f"{what}的访问级别不允许写入")


async def _save(
    session: AsyncSession,
    *,
    model: AcModel,
    payload: PublicationPutIn,
    found: dict[uuid.UUID, ResolvedNode],
) -> PublicationView:
    """落库：发布配置整行覆盖，组合绑定整体替换。

    ⚠ 顺序不能换——**先删组合绑定，再改实例**：复合外键指着「模型 + 实例」，
    实例先变会让还没删掉的旧绑定当场违反外键。

    Args: session, model, payload, found。
    """
    await ac_model_set_binding_crud.clear(session, model.id)
    await _upsert(session, model_id=model.id, payload=payload, found=found)
    await _flush(session)
    await ac_model_set_binding_crud.add_all(
        session,
        [
            AcModelSetBinding(
                model_id=model.id,
                opcua_instance_id=payload.opcua_instance_id,
                set_key=binding.set_key,
                node_id=binding.node_id,
                identifier=_identifier_of(found, binding.node_id),
            )
            for binding in payload.set_bindings
        ],
    )
    await _flush(session)
    await session.commit()
    _logger.info(
        "ac_publication_saved",
        "预测下发配置已保存",
        model_id=str(model.id),
        opcua_instance_id=str(payload.opcua_instance_id),
        set_binding_count=len(payload.set_bindings),
        is_enabled=payload.is_enabled,
    )
    return await get_view(session, model.id)


def _identifier_of(
    found: dict[uuid.UUID, ResolvedNode], node_id: uuid.UUID
) -> str:
    """点位标识的快照。

    ⚠ 只为页面与日志好读，判等一律用 id。取的是刚刚问回来的真名，不是
    调用方传来的——传来的那份可能是页面上早已过期的显示值。

    Args: found, node_id。
    """
    resolved = found.get(node_id)
    return (resolved.identifier or "") if resolved is not None else ""


async def _upsert(
    session: AsyncSession,
    *,
    model_id: uuid.UUID,
    payload: PublicationPutIn,
    found: dict[uuid.UUID, ResolvedNode],
) -> AcModelPublication:
    """建或改发布配置行。心跳字段（上次发布）不动。

    Args: session, model_id, payload, found。
    """
    row = await ac_model_publication_crud.find(session, model_id)
    if row is None:
        row = AcModelPublication(model_id=model_id)
        session.add(row)
    row.opcua_instance_id = payload.opcua_instance_id
    row.recommendation_node_id = payload.recommendation_node_id
    row.recommendation_identifier = (
        None
        if payload.recommendation_node_id is None
        else _identifier_of(found, payload.recommendation_node_id)
    )
    row.is_enabled = payload.is_enabled
    return row


async def _flush(session: AsyncSession) -> None:
    """落一次盘；撞上唯一约束就是别的模型已经绑走了这个点位。

    Args: session。
    """
    try:
        await session.flush()
    except IntegrityError as error:
        raise PublicationNodeTaken(
            "这些点位里有已经被别的模型绑走的，一个点位只能有一个来源"
        ) from error


async def delete_publication(
    session: AsyncSession, model_id: uuid.UUID
) -> None:
    """解绑。没配过也算成功——DELETE 必须幂等。

    ⚠ 只删配置，**不动点位上此刻的值**：解绑之后现场读到的还是最后一次写进去
    的那个数。要清零得由人显式去写，平台不替他决定「不发布了就该写什么」。

    Args: session, model_id。
    """
    await ac_model_service.get_model(session, model_id)
    removed = await ac_model_publication_crud.delete_by_model(session, model_id)
    await session.commit()
    if removed:
        _logger.info(
            "ac_publication_cleared",
            "预测下发配置已解绑",
            model_id=str(model_id),
        )
