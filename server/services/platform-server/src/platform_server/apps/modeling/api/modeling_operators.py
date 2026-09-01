"""算子目录。读用 `modeling:view`。

⚠ 现取不落库：schema 存 DB 会有两份，一处不同步就出现「界面上的表单和实际参数
对不上」（docs/MODELING_DESIGN.md D15）。
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.deps import require
from platform_server.apps.modeling.operators import registry
from platform_server.apps.modeling.schemas import OperatorOut
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/modeling-operators", tags=["modeling-operator"]
)

ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]


@router.get(
    "", response_model=ApiResponse[list[OperatorOut]], summary="算子目录"
)
async def list_operators(_viewer: ViewDep) -> ApiResponse[list[OperatorOut]]:
    """全部算子的完整描述：端口、契约、参数 schema 一次给全。

    Args: _viewer。
    """
    return ok(
        [
            OperatorOut.model_validate(spec.model_dump())
            for spec in registry.specs()
        ]
    )
