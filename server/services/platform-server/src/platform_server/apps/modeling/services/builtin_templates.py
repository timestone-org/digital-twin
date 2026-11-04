"""内置模板静态目录的后端检索、分类与分页。"""

from lib.web import Page, PageParams
from platform_server.apps.modeling.builtin_template_catalog import (
    BUILTIN_TEMPLATE_CATALOG,
)
from platform_server.apps.modeling.schemas.builtin_template import (
    BuiltinModelingTemplateOut,
    BuiltinTemplateFilter,
)


def list_templates(
    page: PageParams, keyword: str | None, category: BuiltinTemplateFilter
) -> Page[BuiltinModelingTemplateOut]:
    word = (keyword or "").casefold()
    selected = [
        BuiltinModelingTemplateOut.model_validate(
            {"key": key, "label": label, "hint": hint, "category": kind}
        )
        for key, label, hint, kind in BUILTIN_TEMPLATE_CATALOG
        if (category == "all" or (key != "blank" and kind == category))
        and word in f"{label} {hint}".casefold()
    ]
    return Page(
        items=selected[page.offset : page.offset + page.size],
        page=page.page,
        size=page.size,
        total=len(selected),
    )
