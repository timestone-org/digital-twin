"""模板列表查询不许把整包一起拖出来，翻页序也不许不确定。

⚠ 「出参里没有 payload」不等于「库里没读 payload」：不把那一列 defer 掉，
一页 20 条照样从库里拖十几 MB，而这件事在响应体上完全看不出来。
"""

from platform_server.apps.dashboard.crud.template import template_crud

CATEGORY_CLAUSE = "dashboard_templates.category ="


def compiled(*, category: str | None) -> str:
    """列表查询编译出来的 SQL。

    Args: category。
    """
    return str(template_crud.build_query(category=category))


def test_the_list_query_never_selects_the_package_column() -> None:
    assert "payload_json" not in compiled(category=None)


def test_the_list_query_still_selects_what_the_wall_shows() -> None:
    # 上面那条会在整条查询写坏时也全绿，这里钉住它确实选了东西
    sql = compiled(category=None)
    assert "dashboard_templates.name" in sql
    assert "dashboard_templates.thumbnail" in sql


def test_no_category_means_no_filter() -> None:
    assert CATEGORY_CLAUSE not in compiled(category=None)


def test_a_category_becomes_an_equality_filter() -> None:
    assert CATEGORY_CLAUSE in compiled(category="光伏")


def test_the_newest_template_comes_first() -> None:
    assert "ORDER BY platform.dashboard_templates.created_at DESC" in compiled(
        category=None
    )


def test_the_order_breaks_ties_so_pages_do_not_overlap() -> None:
    # 同一毫秒建出来的两条若无次序，翻页时它们会在两页之间来回跳
    assert (
        compiled(category=None)
        .rstrip()
        .endswith("platform.dashboard_templates.id DESC")
    )
