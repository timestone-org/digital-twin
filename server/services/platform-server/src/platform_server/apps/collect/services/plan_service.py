"""采集计划的构建：全量下发 + 内容摘要版本号。

collector 只按 `version` 判断要不要重新收敛，**不做增量**——增量消息丢一条就
永久错位，而错位的采集会写出看似正常的错误历史（ADR-0001 代价一节）。
"""

import hashlib
import json

from sqlalchemy.ext.asyncio import AsyncSession

from collectwire import CollectPlan, PlanSource
from platform_server.apps.collect.crud import point_crud, source_crud
from platform_server.apps.collect.models import CollectPoint, CollectSource
from platform_server.apps.collect.services.credentials import CredentialCipher
from platform_server.apps.collect.services.presenters import to_plan_source
from platform_server.apps.runtime_params.services import param_service

PlanParams = dict[str, dict[str, bool | int | float]]


async def build_plan(
    session: AsyncSession, *, cipher: CredentialCipher
) -> CollectPlan:
    """读出全量计划。只下发已启用的数据源。

    ⚠ 停用的源整条不下发，而不是下发一个「停用」标记：collector 的收敛逻辑
    是「计划里有的就该活着」，多一个状态位就多一条只有一个实现验证的分支。
    ⚠ 口令在这里解密进计划：这条路只通到 `/internal/` 的服务级密钥端点，
    解不开按未配置下发（credentials.py 里已响亮记日志）。
    Args: session, cipher。
    """
    sources = await source_crud.list_all(session)
    points = await point_crud.list_all(session)
    grouped: dict[str, list[CollectPoint]] = {}
    for point in points:
        grouped.setdefault(str(point.source_id), []).append(point)
    rendered = [
        to_plan_source(
            source,
            points=grouped.get(str(source.id), []),
            password=_password_of(cipher, source),
        )
        for source in sources
        if source.is_enabled
    ]
    params = await param_service.overrides_for_plan(session)
    return CollectPlan(
        version=plan_version(rendered, params),
        sources=tuple(rendered),
        params=params,
    )


def _password_of(cipher: CredentialCipher, source: CollectSource) -> str | None:
    """一个数据源解密后的口令；没配或解不开都是 None。

    Args: cipher, source。
    """
    if source.credential_enc is None:
        return None
    return cipher.decrypt(source.credential_enc)


def plan_version(sources: list[PlanSource], params: PlanParams) -> str:
    """按计划内容算摘要。

    ⚠ 不用 `max(updated_at)`：删掉一个点位不会让任何一行的时刻变新，用时间戳
    做版本，删除就永远推不下去——而 collector 会继续采一个已经删掉的点位。
    ⚠ 运行参数覆盖也进摘要：拨一个旋钮就该触发一次重新收敛。
    Args: sources, params。
    """
    payload = {
        "sources": [item.model_dump(mode="json") for item in sources],
        "params": params,
    }
    body = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()
