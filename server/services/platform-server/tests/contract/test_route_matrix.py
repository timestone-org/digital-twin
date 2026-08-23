"""每条对外路由都必须自己声明权限码，且声明的是闸 1 那套里同一个码。

⚠ 双口径漂移完全静默：边缘的规则说要 `ac:view`、端点上写的是 `ac:manage`，
两边都不会报错，只会在某个账号身上表现为「按钮亮着但点了 403」或反过来。

⚠ 闸 1 的规则表在 **auth-server** 的 `apps/auth/catalog.py`，服务之间不许互相
import，故这里只能把那套口径复述成 `EXPECTED`。改了那边就要改这里——这是本
分支唯一一处没有机器把两侧钉在一起的地方。
"""

import re
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute

from platform_server.apps.collect.api import ROUTERS as COLLECT_ROUTERS
from platform_server.apps.collect.catalog import (
    COLLECT_MANAGE,
    COLLECT_OPERATE,
    COLLECT_VIEW,
)
from platform_server.apps.collect.deps import require_service_key
from platform_server.apps.dashboard.api import ROUTERS as DASHBOARD_ROUTERS
from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_MANAGE,
    DASHBOARD_VIEW,
)
from platform_server.apps.dataset.api import ROUTERS as DATASET_ROUTERS
from platform_server.apps.dataset.catalog import (
    DATASET_MANAGE,
    DATASET_VIEW,
)
from platform_server.apps.hvac.api import ROUTERS as HVAC_ROUTERS
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.runtime_params.api import (
    ROUTERS as RUNTIME_PARAM_ROUTERS,
)
from platform_server.deps import (
    REQUIRED_CODES_ATTR,
    REQUIRED_MODE_ATTR,
    get_session,
)
from platform_server.settings import API_PREFIX, INTERNAL_PREFIX

ROUTERS = (
    *HVAC_ROUTERS,
    *DASHBOARD_ROUTERS,
    *COLLECT_ROUTERS,
    *DATASET_ROUTERS,
    *RUNTIME_PARAM_ROUTERS,
)

SAMPLE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
_PARAM = re.compile(r"\{[^}]+\}")

# 与 auth-server catalog 里 `/api/v1/platform/*` 那五条规则逐字对应
EXPECTED: dict[str, frozenset[str]] = {
    "GET": frozenset({AC_VIEW}),
    "POST": frozenset({AC_MANAGE}),
    "PUT": frozenset({AC_MANAGE}),
    "PATCH": frozenset({AC_MANAGE}),
    "DELETE": frozenset({AC_MANAGE}),
}
# 闸 1 里为个别端点开的**窄放行**（更高 priority 的窄规则压过按方法的兜底），
# 同样只能逐条复述。⚠ 方向是放松，所以每一条都必须对应 auth catalog 里一条
# 真实存在的窄规则——这里单方面登记等于绕过边缘口径给自己开洞。
NARROWED_IN_GATE_ONE: dict[tuple[str, str], frozenset[str]] = {
    # auth catalog：POST /api/v1/platform/ac-models/*:predict → ac:view（905）
    (f"{API_PREFIX}/ac-models/{{model_id}}:predict", "POST"): frozenset(
        {AC_VIEW}
    ),
    # auth catalog：POST /api/v1/platform/ac-models/*:recommend → ac:view（906）
    (f"{API_PREFIX}/ac-models/{{model_id}}:recommend", "POST"): frozenset(
        {AC_VIEW}
    ),
}

# 大屏面自带一套权限码，闸 1 里对应的是按前缀的窄规则（priority 高于按方法
# 兜底的那四条）。⚠ 与上面同理，这里只是复述 auth-server catalog 的口径。
DASHBOARD_PREFIXES = (
    f"{API_PREFIX}/dashboard-projects",
    f"{API_PREFIX}/dashboard-templates",
    f"{API_PREFIX}/dashboards",
    f"{API_PREFIX}/dashboard-nodes",
    f"{API_PREFIX}/dashboard-bindings",
    f"{API_PREFIX}/module-types",
)
# 建删项目与大屏归 manage，改内容归 edit，读面归 view
DASHBOARD_MANAGED = (
    (f"{API_PREFIX}/dashboard-projects", "POST"),
    (f"{API_PREFIX}/dashboard-projects/{{project_id}}", "PATCH"),
    (f"{API_PREFIX}/dashboard-projects/{{project_id}}", "DELETE"),
    (f"{API_PREFIX}/dashboards", "POST"),
    (f"{API_PREFIX}/dashboards/{{dashboard_id}}", "DELETE"),
    # 复制与导入都**建出一张新屏**，与「建大屏」同一类，不是「改内容」
    (f"{API_PREFIX}/dashboards/{{dashboard_id}}:duplicate", "POST"),
    (f"{API_PREFIX}/dashboards:import", "POST"),
    # 公开一张屏是把它交给全互联网，与改一行配置不是同一类操作
    (f"{API_PREFIX}/dashboards/{{dashboard_id}}:publish", "POST"),
    (f"{API_PREFIX}/dashboards/{{dashboard_id}}:unpublish", "POST"),
    # 模板全局可见：建一份等于给所有项目加一个可复制的起点，删一份影响全部引用方
    (f"{API_PREFIX}/dashboard-templates", "POST"),
    (f"{API_PREFIX}/dashboard-templates/{{template_id}}", "DELETE"),
    (f"{API_PREFIX}/dashboard-templates/{{template_id}}:instantiate", "POST"),
)
# 读面里唯一一条要 manage 的：读到的就是那条谁拿到谁能看的公开链接。
# ⚠ 能看见一张屏与能把它发给全互联网不是同一件事，故它不随 GET 落到 view
DASHBOARD_MANAGED_READS = (
    (f"{API_PREFIX}/dashboards/{{dashboard_id}}/publication", "GET"),
)
# 什么都不改，是 POST 只因为动作端点一律 POST，故按读面放行。
# ⚠ 漏登记一条的表现不是报错，是只读用户点下去收 403——而他明明看得见那张屏
DASHBOARD_READ_ACTIONS = (
    (f"{API_PREFIX}/dashboards/{{dashboard_id}}:validate", "POST"),
    (f"{API_PREFIX}/dashboards/{{dashboard_id}}:export", "POST"),
)


# 采集配置面自带一套权限码，闸 1 里对应的同样是按前缀的窄规则。
# ⚠ 与大屏面同理，这里只是复述 auth-server catalog 的口径。
COLLECT_PREFIXES = (
    f"{API_PREFIX}/collect-sources",
    f"{API_PREFIX}/collect-points",
    # 采集/归档两组运行参数：读 view、写 manage，与采集配置面同一套码
    f"{API_PREFIX}/collect-runtime-params",
    f"{API_PREFIX}/point-histories",
)
# 触碰现场设备的四条动作端点归 operate：它们会在物理设备上产生一次真实往返，
# 与「改一行配置」不是同一类风险
COLLECT_OPERATED = (
    (f"{API_PREFIX}/collect-sources/{{source_id}}:test", "POST"),
    (f"{API_PREFIX}/collect-sources/{{source_id}}:browse", "POST"),
    (f"{API_PREFIX}/collect-sources/{{source_id}}:browse-subtree", "POST"),
    (f"{API_PREFIX}/collect-points/{{point_id}}:write", "POST"),
)
# 聚合不改任何东西，是 POST 只因为它是动作端点，故按读面放行
COLLECT_READ_ACTIONS = ((f"{API_PREFIX}/point-histories:aggregate", "POST"),)


def collect_expectation(path: str, method: str) -> frozenset[str] | None:
    """采集面某条路由该要哪个码；不是采集面的路由给 None。

    Args: path, method。
    """
    if not any(path.startswith(prefix) for prefix in COLLECT_PREFIXES):
        return None
    if method == "GET" or (path, method) in COLLECT_READ_ACTIONS:
        return frozenset({COLLECT_VIEW})
    if (path, method) in COLLECT_OPERATED:
        return frozenset({COLLECT_OPERATE})
    return frozenset({COLLECT_MANAGE})


# 数据台账（`dataset-tables` 与它下面的列）。闸 1 里对应的同样是按前缀的窄规则，
# 阶梯只有两级：写兜底 + 读。记录、修正、导出、回填各有自己的码，随它们的端点
# 一起登记（docs/DATASET_DESIGN.md §9）。
DATASET_PREFIXES = (f"{API_PREFIX}/dataset-tables",)


def dataset_expectation(path: str, method: str) -> frozenset[str] | None:
    """台账面某条路由该要哪个码；不是台账面的路由给 None。

    Args: path, method。
    """
    if not any(path.startswith(prefix) for prefix in DATASET_PREFIXES):
        return None
    if method == "GET":
        return frozenset({DATASET_VIEW})
    return frozenset({DATASET_MANAGE})


# 运行参数自成一段。⚠ 它既不匹配 `dashboard*` 也不匹配 `collect-*`，闸 1 里
# 靠 925/927 两条专门的规则托住；少了那两条它会掉进 900 的方法兜底，
# 表现是「改大屏推送节拍要 `ac:manage`」——管空调的人能调，管大屏的人反而不能。
RUNTIME_PARAM_PREFIX = f"{API_PREFIX}/runtime-params"


def runtime_param_expectation(path: str, method: str) -> frozenset[str] | None:
    """运行参数某条路由该要哪个码；不是这一面的路由给 None。

    Args: path, method。
    """
    if not path.startswith(RUNTIME_PARAM_PREFIX):
        return None
    # 看得见节拍不等于能改，故读写分两个码
    if method == "GET":
        return frozenset({DASHBOARD_VIEW})
    return frozenset({DASHBOARD_EDIT})


def dashboard_expectation(path: str, method: str) -> frozenset[str] | None:
    """大屏面某条路由该要哪个码；不是大屏面的路由给 None。

    Args: path, method。
    """
    if not any(path.startswith(prefix) for prefix in DASHBOARD_PREFIXES):
        return None
    if (path, method) in DASHBOARD_MANAGED_READS:
        return frozenset({DASHBOARD_MANAGE})
    if method == "GET" or (path, method) in DASHBOARD_READ_ACTIONS:
        return frozenset({DASHBOARD_VIEW})
    if (path, method) in DASHBOARD_MANAGED:
        return frozenset({DASHBOARD_MANAGE})
    return frozenset({DASHBOARD_EDIT})


# ⚠ 闸 2 严于闸 1 的端点必须逐条登记。闸 1 只按方法兜（GET → ac:view），而
# 这条 GET 暴露的是外库的结构，故端点自己再收一道到 ac:manage。方向是安全的
# （边缘放行、端点拒绝），但反过来——端点比边缘松——是一个静默的越权洞，
# 所以下面的断言仍然要求「不在这张表里的端点必须与闸 1 逐字相同」。
STRICTER_THAN_GATE_ONE: dict[tuple[str, str], frozenset[str]] = {
    (f"{API_PREFIX}/ac-datasets/{{dataset}}/source-objects", "GET"): frozenset(
        {AC_MANAGE}
    ),
}

# 公开大屏：全服务唯一一条**业务**匿名端点（ADR-0014）。凭据是 URL 里的
# 公开令牌，由端点自己按「已发布」核对，故它没有、也不该有任何权限码。
PUBLIC_DASHBOARD_PATH = f"{API_PREFIX}/public-dashboards/{{public_token}}"

# 探针与文档不吃身份头，它们在边缘走免认证 location
UNGUARDED = frozenset(
    {
        f"{API_PREFIX}/health",
        f"{API_PREFIX}/ready",
        f"{API_PREFIX}/docs",
        f"{API_PREFIX}/redoc",
        f"{API_PREFIX}/openapi.json",
        PUBLIC_DASHBOARD_PATH,
    }
)


def build_app() -> FastAPI:
    """只装路由，不连任何依赖。"""
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    return app


def iter_routes(app: FastAPI) -> Iterator[APIRoute]:
    """遍历应用里全部的 APIRoute，含被 include 进来的子路由。

    ⚠ 不能只顺着 `.routes` 走：`include_router` 挂进来的是一个包装对象，
    真正的路由挂在它的 `original_router` 上。只走 `.routes` 会一条都取不到，
    参数化列表因此为空——而 pytest 把空参数化标成 skip，用例于是空跑且全绿。
    Args: app。
    """
    stack: list[Any] = list(app.routes)
    while stack:
        item = stack.pop()
        if isinstance(item, APIRoute):
            yield item
        for attribute in ("routes", "original_router"):
            nested = getattr(item, attribute, None)
            if nested is None:
                continue
            stack.extend(nested if isinstance(nested, list) else [nested])


def gate_two_requirement(route: APIRoute) -> tuple[frozenset[str], str]:
    """端点自己声明的权限码与判定模式。

    Args: route。
    """
    codes: set[str] = set()
    mode = "all"
    pending = list(route.dependant.dependencies)
    while pending:
        dependency = pending.pop()
        declared = getattr(dependency.call, REQUIRED_CODES_ATTR, None)
        if declared is not None:
            codes |= set(declared)
            mode = getattr(dependency.call, REQUIRED_MODE_ATTR, "all")
        pending.extend(dependency.dependencies)
    return frozenset(codes), mode


def internal_routes() -> list[tuple[str, str]]:
    """内部面的全部 (路径, 方法)。它们走服务级密钥，不走权限码。"""
    result: list[tuple[str, str]] = []
    for route in iter_routes(build_app()):
        if not route.path.startswith(INTERNAL_PREFIX):
            continue
        result.extend(
            (route.path, method)
            for method in sorted(route.methods or set())
            if method not in {"HEAD", "OPTIONS"}
        )
    return result


def public_routes() -> list[tuple[str, str]]:
    """对外面的全部 (路径, 方法)。内部面另算，见 `internal_routes`。"""
    result: list[tuple[str, str]] = []
    for route in iter_routes(build_app()):
        if route.path in UNGUARDED or route.path.startswith(INTERNAL_PREFIX):
            continue
        for method in sorted(route.methods or set()):
            if method in {"HEAD", "OPTIONS"}:
                continue
            result.append((route.path, method))
    return result


ROUTE_CASES = public_routes()


def test_the_route_table_was_actually_scanned() -> None:
    # ⚠ 扫不到路由就等于下面那条契约没跑，而空参数化在 pytest 里是 skip 不是红
    assert len(ROUTE_CASES) > 0


def test_every_public_route_lives_under_the_service_prefix() -> None:
    stray = [path for path, _ in ROUTE_CASES if not path.startswith(API_PREFIX)]
    assert stray == []


@pytest.mark.parametrize(
    ("path", "method"),
    ROUTE_CASES,
    ids=[f"{method} {path}" for path, method in ROUTE_CASES],
)
def test_gate_two_requires_the_code_gate_one_requires(
    path: str, method: str
) -> None:
    route = next(
        item
        for item in iter_routes(build_app())
        if item.path == path and method in (item.methods or set())
    )
    codes, mode = gate_two_requirement(route)
    expected = (
        dashboard_expectation(path, method)
        or collect_expectation(path, method)
        or runtime_param_expectation(path, method)
        or dataset_expectation(path, method)
        or STRICTER_THAN_GATE_ONE.get(
            (path, method),
            NARROWED_IN_GATE_ONE.get((path, method), EXPECTED[method]),
        )
    )
    assert codes == expected
    assert mode == "all"


def test_overrides_only_ever_tighten_to_the_manage_code() -> None:
    # 只允许收紧到写权限。收紧成别的码等于给这条路由发明了第三套口径，
    # 而登记成与闸 1 相同的码则是白留一个豁免位，下次有人会顺手用它放松
    assert [
        codes
        for codes in STRICTER_THAN_GATE_ONE.values()
        if codes != frozenset({AC_MANAGE})
    ] == []


def test_every_dashboard_route_carries_exactly_one_dashboard_code() -> None:
    # 大屏面的三个码互斥：同时要两个等于把「能看」与「能改」搅在一起
    spread = [
        f"{method} {path}"
        for path, method in ROUTE_CASES
        if (expected := dashboard_expectation(path, method)) is not None
        and len(expected) != 1
    ]
    assert spread == []


def test_the_dashboard_face_was_actually_covered() -> None:
    # 前缀写错时上面那条会退回按方法的口径而全绿，这里钉住覆盖面不为空
    covered = [
        (path, method)
        for path, method in ROUTE_CASES
        if dashboard_expectation(path, method) is not None
    ]
    assert len(covered) == 40


def test_every_manage_entry_still_points_at_a_live_route() -> None:
    # 端点改名后这张表会静默失效，那条路由于是悄悄退回 edit 的宽口径
    assert set(DASHBOARD_MANAGED) <= set(ROUTE_CASES)
    assert set(DASHBOARD_MANAGED_READS) <= set(ROUTE_CASES)
    assert set(DASHBOARD_READ_ACTIONS) <= set(ROUTE_CASES)


def test_every_override_still_points_at_a_live_route() -> None:
    # 端点改名后这张表会静默失效，那条路由于是悄悄退回闸 1 的宽口径
    assert set(STRICTER_THAN_GATE_ONE) <= set(ROUTE_CASES)
    assert set(NARROWED_IN_GATE_ONE) <= set(ROUTE_CASES)


def test_no_public_route_is_left_unguarded() -> None:
    unguarded = [
        f"{method} {path}"
        for path, method in ROUTE_CASES
        if not gate_two_requirement(
            next(
                item
                for item in iter_routes(build_app())
                if item.path == path and method in (item.methods or set())
            )
        )[0]
    ]
    assert unguarded == []


def test_the_anonymous_business_surface_is_exactly_one_route() -> None:
    """⚠ 免认证的业务端点只许有公开大屏这一条（ADR-0014）。

    `UNGUARDED` 是一张手写的豁免名单，往里加一行就能让任何端点绕开上面全部
    契约——加的人多半只是想让红灯变绿。这条把名单本身钉住：探针与文档之外，
    匿名可达的只能是公开大屏。要再开一条，先写 ADR 说明配额与凭据怎么办。
    """
    probes = {
        f"{API_PREFIX}/health",
        f"{API_PREFIX}/ready",
        f"{API_PREFIX}/docs",
        f"{API_PREFIX}/redoc",
        f"{API_PREFIX}/openapi.json",
    }

    assert UNGUARDED - probes == {PUBLIC_DASHBOARD_PATH}


def test_the_public_dashboard_route_really_exists() -> None:
    # 端点改路径后豁免名单会静默失效：那条路由重新落回上面的断言、当场红，
    # 而这条则回答「是不是整条公开面被人删了却没人发现」
    paths = {route.path for route in iter_routes(build_app())}

    assert PUBLIC_DASHBOARD_PATH in paths


def test_action_endpoints_are_post_only() -> None:
    # GET 带副作用会被各级缓存与预取毁掉
    wrong = [
        f"{method} {path}"
        for path, method in ROUTE_CASES
        if ":" in path.rsplit("/", maxsplit=1)[-1] and method != "POST"
    ]
    assert wrong == []


def test_path_parameters_are_substitutable_identifiers() -> None:
    # 路径参数只放标识，其它一切走 query 或 body
    for path, _ in ROUTE_CASES:
        assert "{" not in _PARAM.sub(SAMPLE_ID, path)


INTERNAL_CASES = internal_routes()


def test_the_internal_face_was_actually_scanned() -> None:
    # ⚠ 前缀写错时下面那条会空跑而全绿，而内部面就此无人守
    assert len(INTERNAL_CASES) == 1


@pytest.mark.parametrize(
    ("path", "method"),
    INTERNAL_CASES,
    ids=[f"{method} {path}" for path, method in INTERNAL_CASES],
)
def test_every_internal_route_demands_the_service_key(
    path: str, method: str
) -> None:
    # ⚠ 内部面挡的是「任何人」，而权限码挂在人身上（ADR-0005）：
    # 漏挂这道依赖，任何能连到端口的人都能拉走全量采集计划
    route = next(
        item
        for item in iter_routes(build_app())
        if item.path == path and method in (item.methods or set())
    )
    guards = {dependency.call for dependency in route.dependant.dependencies}
    assert require_service_key in guards


def test_no_internal_route_leaks_into_the_public_face() -> None:
    assert [path for path, _ in ROUTE_CASES if INTERNAL_PREFIX in path] == []


def test_every_collect_route_carries_exactly_one_collect_code() -> None:
    # 采集面的三个码互斥：同时要两个等于把「能看」「能改配置」「能碰现场」
    # 搅在一起，而它们的风险完全不同
    spread = [
        f"{method} {path}"
        for path, method in ROUTE_CASES
        if (expected := collect_expectation(path, method)) is not None
        and len(expected) != 1
    ]
    assert spread == []


def test_the_collect_face_was_actually_covered() -> None:
    # 前缀写错时上面那条会退回按方法的口径而全绿，这里钉住覆盖面
    covered = [
        (path, method)
        for path, method in ROUTE_CASES
        if collect_expectation(path, method) is not None
    ]
    # 15 条配置/动作面 + 3 条采集运行参数面
    assert len(covered) == 18


def test_every_field_action_still_points_at_a_live_route() -> None:
    # 端点改名后这张表会静默失效，那条路由于是悄悄退回 manage 的口径
    assert set(COLLECT_OPERATED) <= set(ROUTE_CASES)
    assert set(COLLECT_READ_ACTIONS) <= set(ROUTE_CASES)


def test_every_dataset_route_carries_exactly_one_dataset_code() -> None:
    # 台账面的两个码互斥：同时要两个等于把「能看」与「能改结构」搅在一起
    spread = [
        f"{method} {path}"
        for path, method in ROUTE_CASES
        if (expected := dataset_expectation(path, method)) is not None
        and len(expected) != 1
    ]
    assert spread == []


def test_the_dataset_face_was_actually_covered() -> None:
    # 前缀写错时上面那条会退回按方法的口径而全绿，这里钉住覆盖面
    covered = [
        (path, method)
        for path, method in ROUTE_CASES
        if dataset_expectation(path, method) is not None
    ]
    # 5 条台账面 + 5 条列面
    assert len(covered) == 10


def test_every_route_takes_its_session_from_the_one_place() -> None:
    """事务件只许有一份。

    ⚠ 分叉出第二份的代价是真发生过的：某个功能模块自带一份 `get_session` 时，
    夹具漏换了它，那个模块于是打**真库真提交**——表现是「单跑绿、连着跑红」，
    而残留行会一直躺在库里毒下一次运行。
    """
    seen: set[object] = set()
    for route in iter_routes(build_app()):
        pending = list(route.dependant.dependencies)
        while pending:
            dependency = pending.pop()
            name = getattr(dependency.call, "__name__", "")
            if name == "get_session":
                seen.add(dependency.call)
            pending.extend(dependency.dependencies)
    assert seen == {get_session}
