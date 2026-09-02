"""供应商面：列、建、看、改、删，以及探一次端点通不通。

读用 `llm:view`，写与探测用 `llm:manage`。⚠ 探测归 manage 而不是 view：它拿着
密钥去打外部端点，看得见目录的人不该能拿目录里的密钥去试别的地址。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.llm_providers.catalog import LLM_VIEW
from platform_server.apps.llm_providers.deps import (
    CipherDep,
    ManageDep,
    ProbeTimeoutDep,
    get_session,
    require,
)
from platform_server.apps.llm_providers.schemas import (
    LlmProbeIn,
    LlmProbeOut,
    LlmProviderIn,
    LlmProviderOut,
    LlmProviderUpdateIn,
)
from platform_server.apps.llm_providers.services import (
    probe_endpoint,
    provider_service,
)
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/llm-providers", tags=["llm-provider"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(LLM_VIEW))]


@router.get(
    "", response_model=ApiResponse[Page[LlmProviderOut]], summary="供应商列表"
)
async def list_all(
    session: SessionDep, _viewer: ViewDep, page: PageDep
) -> ApiResponse[Page[LlmProviderOut]]:
    """分页列出供应商。密钥只露尾巴。

    Args: session, _viewer, page。
    """
    items, total = await provider_service.list_providers(
        session, offset=page.offset, limit=page.size
    )
    return ok(
        Page[LlmProviderOut](
            items=items, page=page.page, size=page.size, total=total
        )
    )


@router.post(
    "",
    response_model=ApiResponse[LlmProviderOut],
    status_code=status.HTTP_201_CREATED,
    summary="新建供应商",
)
async def create(
    body: LlmProviderIn,
    session: SessionDep,
    cipher: CipherDep,
    write: ManageDep,
    response: Response,
) -> ApiResponse[LlmProviderOut]:
    """建一路供应商。支持 `Idempotency-Key`。

    Args: body, session, cipher, write, response。
    """
    created = await write.run_once(
        endpoint="create_llm_provider",
        model=LlmProviderOut,
        action=lambda: provider_service.create_provider(
            session, body, cipher=cipher, actor=str(write.caller.user_id)
        ),
    )
    response.headers["Location"] = f"{API_PREFIX}/llm-providers/{created.id}"
    return ok(created, message="供应商已创建")


@router.get(
    "/{provider_id}",
    response_model=ApiResponse[LlmProviderOut],
    summary="供应商详情",
)
async def get_one(
    session: SessionDep, _viewer: ViewDep, provider_id: uuid.UUID
) -> ApiResponse[LlmProviderOut]:
    """取一路供应商。

    Args: session, _viewer, provider_id。
    """
    return ok(await provider_service.read_provider(session, provider_id))


@router.patch(
    "/{provider_id}",
    response_model=ApiResponse[LlmProviderOut],
    summary="更新供应商",
)
async def update(
    provider_id: uuid.UUID,
    body: LlmProviderUpdateIn,
    session: SessionDep,
    cipher: CipherDep,
    write: ManageDep,
) -> ApiResponse[LlmProviderOut]:
    """改一路供应商；不带 `api_key` 就沿用旧的。

    Args: provider_id, body, session, cipher, write。
    """
    updated = await provider_service.update_provider(
        session,
        provider_id,
        body,
        cipher=cipher,
        actor=str(write.caller.user_id),
    )
    return ok(updated, message="供应商已更新")


@router.delete(
    "/{provider_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除供应商",
)
async def remove(
    provider_id: uuid.UUID, session: SessionDep, write: ManageDep
) -> Response:
    """删一路供应商。还被用途指着就 409。

    Args: provider_id, session, write。
    """
    await provider_service.delete_provider(
        session, provider_id, actor=str(write.caller.user_id)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    ":probe",
    response_model=ApiResponse[LlmProbeOut],
    summary="保存前探一次端点",
)
async def probe_draft(
    body: LlmProbeIn, _write: ManageDep, timeout_s: ProbeTimeoutDep
) -> ApiResponse[LlmProbeOut]:
    """拿表单里填的地址与密钥探一次，不落任何东西。

    Args: body, _write, timeout_s。
    """
    made = await probe_endpoint(
        base_url=body.base_url,
        api_key=body.api_key.get_secret_value(),
        timeout_s=timeout_s,
    )
    return ok(LlmProbeOut(**made.__dict__))


@router.post(
    "/{provider_id}:probe",
    response_model=ApiResponse[LlmProbeOut],
    summary="按已存的密钥探一次端点",
)
async def probe_stored(
    provider_id: uuid.UUID,
    session: SessionDep,
    cipher: CipherDep,
    _write: ManageDep,
    timeout_s: ProbeTimeoutDep,
) -> ApiResponse[LlmProbeOut]:
    """拿库里那一把密钥探一次。密钥不出门。

    Args: provider_id, session, cipher, _write, timeout_s。
    """
    base_url, api_key = await provider_service.stored_api_key(
        session, provider_id, cipher=cipher
    )
    made = await probe_endpoint(
        base_url=base_url, api_key=api_key, timeout_s=timeout_s
    )
    return ok(LlmProbeOut(**made.__dict__))
