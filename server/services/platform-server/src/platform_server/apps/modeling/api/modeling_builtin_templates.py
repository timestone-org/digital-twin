"""内置模板目录读取面，身份与用途说明不包含执行图。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BeforeValidator

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.deps import require
from platform_server.apps.modeling.schemas.builtin_template import (
    BuiltinModelingTemplateOut,
    BuiltinTemplateFilter,
)
from platform_server.apps.modeling.schemas.common import normalize_search
from platform_server.apps.modeling.services import builtin_templates
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/modeling-builtin-templates",
    tags=["modeling-template"],
)
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
PageDep = Annotated[PageParams, Depends(page_params)]


@router.get(
    "",
    response_model=ApiResponse[Page[BuiltinModelingTemplateOut]],
    summary="内置模板目录",
)
async def list_builtin_templates(
    _viewer: ViewDep,
    page: PageDep,
    q: Annotated[
        str | None, Query(max_length=128), BeforeValidator(normalize_search)
    ] = None,
    category: BuiltinTemplateFilter = "all",
) -> ApiResponse[Page[BuiltinModelingTemplateOut]]:
    return ok(builtin_templates.list_templates(page, q, category))
