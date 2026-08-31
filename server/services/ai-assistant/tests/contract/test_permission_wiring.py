"""`PermissionGate` 有没有真的通电。

守的是一类特别难查的故障：**闸装好了但没接线**。`intent/gates/permission.py`
写得再对，只要 `advance_service` 那一路不把调用者的权限码传进去，`codes` 就恒为
`None`，这一道原样放行——而它长得与「这个人确实什么都能用」一模一样。

⚠ 另一半是安全条款：权限码只许来自**已认证的** `CallerContext`，绝不许从
`AdvanceIn` 载荷取。载荷是用户可控的，从那里取等于让人自己声明自己有哪些码。
"""

import inspect
from typing import get_type_hints

from ai_assistant.apps.chat import deps as chat_deps
from ai_assistant.apps.chat.schemas.advance import AdvanceIn
from ai_assistant.apps.chat.services import advance_service
from ai_assistant.apps.chat.services.advance_service import AdvanceDeps
from lib.auth import CallerContext


def test_the_advance_deps_carry_the_callers_codes() -> None:
    """没有这一格，收窄那一道就只能恒空转。"""
    assert "codes" in {
        field.name for field in AdvanceDeps.__dataclass_fields__.values()
    }


def test_the_route_dependency_asks_for_an_authenticated_caller() -> None:
    """签名里没有 `CallerContext` 就说明这一道没接上线。"""
    hints = get_type_hints(chat_deps.get_advance_deps, include_extras=True)
    annotated = [str(one) for one in hints.values()]
    assert any(CallerContext.__name__ in one for one in annotated)


def test_the_codes_do_not_come_from_the_request_body() -> None:
    """载荷里一旦出现权限码那一格，用户就能自己声明自己有什么权限。"""
    forbidden = {"codes", "permissions", "required_codes"}
    assert forbidden & set(AdvanceIn.model_fields) == set()


def test_the_dependency_passes_the_codes_on_rather_than_dropping_them() -> None:
    """接了 `caller` 却忘了往下传，与根本没接是同一种现象。"""
    source = inspect.getsource(chat_deps.get_advance_deps)
    assert "codes=caller.permissions" in source


def test_deps_of_puts_the_codes_into_the_deps_it_builds() -> None:
    """收了形参却没往下装，是这条链上最容易断的一节。

    ⚠ 这一节是 ruff 的 ARG001 先逮到的，不是这条闸——写它就是为了下次不靠运气。
    """
    source = inspect.getsource(advance_service.deps_of)
    assert "codes=codes" in source
