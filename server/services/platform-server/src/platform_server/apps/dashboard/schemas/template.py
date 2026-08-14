"""整屏模板库的入参与出参。

⚠ 列表项刻意不带 `payload`：一份整屏包动辄几百 KB，一页 20 条就是十几 MB，
而模板墙上要的只是名字、分类与缩略图。缩略图仍随列表走——它就是为了让卡片
渲染得出来才在建模板时从源屏拷了一份。
"""

import uuid
from typing import Annotated

from pydantic import Field, StringConstraints

from platform_server.apps.dashboard.schemas.common import (
    InputModel,
    Label,
    OutputModel,
    Utc,
)
from platform_server.apps.dashboard.schemas.transfer import (
    MAX_DESCRIPTION_LENGTH,
    DashboardExportOut,
)

# 分类是模板墙上的筛选标签，与名字同一套长度口径
Category = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]


class TemplateSummaryOut(OutputModel):
    """模板墙上的一条。带缩略图，不带整包。"""

    id: uuid.UUID
    name: str
    description: str | None
    category: str | None
    thumbnail: str | None
    source_project_id: uuid.UUID | None
    created_at: Utc
    updated_at: Utc


class TemplateOut(TemplateSummaryOut):
    """模板详情。`payload` 与 `:export` 的产出同形，可原样导入。"""

    payload: DashboardExportOut


class TemplateCreateIn(InputModel):
    """把一张大屏另存为模板。

    ⚠ 只收源屏 id：包与缩略图都由服务端从源屏现取。让客户端喂包等于放行
    一份没经过导出侧校验的整屏结构。
    """

    source_dashboard_id: uuid.UUID
    name: Label
    category: Category | None = None
    description: str | None = Field(
        default=None, max_length=MAX_DESCRIPTION_LENGTH
    )


class TemplateInstantiateIn(InputModel):
    """把模板实例化成目标项目下的一张新大屏。缺省名是模板名。"""

    target_project_id: uuid.UUID
    name: Label | None = None
