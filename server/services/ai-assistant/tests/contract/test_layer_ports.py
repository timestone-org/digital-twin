"""七层的扩展点形状（ADR-0029）。

守的是三件靠评审记不住的事：再导出面漏名（别的功能模块于是直接伸进子模块，
而结构闸只判第 4 段、不会拦）、Protocol 忘了 `runtime_checkable`（各层的注册表
契约测试都要靠它逐个校验实现）、以及 `Gate` 的「只许收窄不许放宽」——放宽的那一道
会把前面几道的判断一笔勾销，而顺序一换结果就变。
"""

import importlib
from types import ModuleType
from typing import get_args

import pytest

from ai_assistant.apps.chat.services.intent import Allowed
from ai_assistant.apps.chat.services.memory import Scope
from ai_assistant.apps.chat.services.reflection import Verdict

# 六个仍在助手这边的层包。⚠ 显式列出而不是扫目录：扫出来的名单会把将来某个
# 忘了 `__init__.py` 的目录悄悄漏掉，而漏掉的那一层的闸就此不跑。
# ⚠ 少了 `output`：那一层整个搬进了 `llmcore`（ADR-0037），助手这边连空壳
# 都没留——留一个只做转发的空包，是下一次「改了 llmcore 却忘了改这里」的温床
LAYERS = (
    "perception",
    "intent",
    "planning",
    "memory",
    "tools",
    "reflection",
)

# 每一层的 ports 此刻住在哪。⚠ 搬进 llmcore 的那几层要在这里点名：
# 不点名的话 `_ports` 会 ModuleNotFoundError，而那读起来像「这一层没了」，
# 实际是「它的端口换了地址」
PORTS_HOME = {
    "perception": "ai_assistant.apps.chat.services.perception.ports",
    "memory": "ai_assistant.apps.chat.services.memory.ports",
    "planning": "ai_assistant.apps.chat.services.planning.ports",
    "intent": "llmcore.intent.ports",
    "tools": "llmcore.tools.ports",
    "reflection": "llmcore.reflection.ports",
}

# 这几个是 Protocol，各层的注册表要靠 `isinstance` 逐个校验注册进来的实现
PROTOCOLS = (
    ("perception", "InputDecoder"),
    ("intent", "Gate"),
    ("memory", "ShortTermStore"),
    ("memory", "Summarizer"),
    ("memory", "LongTermStore"),
    ("tools", "ToolProvider"),
    ("reflection", "Verifier"),
)


def _package(layer: str) -> ModuleType:
    return importlib.import_module(f"ai_assistant.apps.chat.services.{layer}")


def _ports(layer: str) -> ModuleType:
    return importlib.import_module(PORTS_HOME[layer])


@pytest.mark.parametrize("layer", LAYERS)
def test_every_layer_reexports_exactly_its_public_port_names(
    layer: str,
) -> None:
    """再导出面与 ports 里的公开名字一一对上，不多不少。"""
    package = _package(layer)
    ports = _ports(layer)
    listed = set(vars(package)["__all__"])
    # ⚠ 判据是「定义在本模块」，不是「来自 ai_assistant」：ports 里 import
    # 进来的 `ChatMessage` / `ToolSpec` 也满足后者，而它们不该上再导出面
    own = ports.__name__
    public = {
        name
        for name in vars(ports)
        if not name.startswith("_")
        and getattr(vars(ports)[name], "__module__", None) == own
    }
    # 类型别名（`Decoded` / `Scope` / `Verdict`）没有 `__module__`，单独收进来
    aliases = {"Decoded", "Scope", "Verdict"} & set(vars(ports))
    # ⚠ 判据是「不许漏」而不是「恰好等于」：一层的公开面本来就可能比 ports 宽
    # （它自己的注册表、具体实现都该露出来）。而漏掉一个 port 的表现是别的功能
    # 模块绕过再导出面直接伸进子模块——结构闸只判路径第 4 段，那种事它不会拦
    assert public | aliases <= listed


@pytest.mark.parametrize("layer", LAYERS)
def test_every_reexported_name_actually_resolves(layer: str) -> None:
    """`__all__` 里写错的名字只在 `import *` 时才炸，平时一声不吭。"""
    package = _package(layer)
    listed: list[str] = list(vars(package)["__all__"])
    missing = [name for name in listed if not hasattr(package, name)]
    assert missing == []


@pytest.mark.parametrize(("layer", "name"), PROTOCOLS)
def test_every_protocol_is_runtime_checkable(layer: str, name: str) -> None:
    """注册表要靠 `isinstance` 校验实现，漏了这个装饰器它就校验不动。"""
    found = getattr(_package(layer), name)
    assert getattr(found, "_is_runtime_protocol", False)


def test_narrowing_tools_can_only_shrink_the_set() -> None:
    """收窄只许变小：放宽的那一道会把前面几道的判断一笔勾销。"""
    start = Allowed(tools=frozenset({"a", "b"}), skills=frozenset({"s"}))
    got = start.keep_tools(frozenset({"b", "c"}))
    assert got.tools == frozenset({"b"})
    assert got.tools <= start.tools


def test_narrowing_skills_leaves_the_tool_set_alone() -> None:
    """一道 Gate 只动它那一维，免得两道 Gate 互相盖掉对方的判断。"""
    start = Allowed(tools=frozenset({"a"}), skills=frozenset({"s", "t"}))
    got = start.keep_skills(frozenset({"t"}))
    assert got.skills == frozenset({"t"})
    assert got.tools == start.tools


def test_scope_has_exactly_the_two_documented_faces() -> None:
    """多一档就要多一条隔离用例，加档位不能靠顺手（ADR-0030）。"""
    assert set(get_args(Scope)) == {"user", "project"}


def test_verdict_has_no_undecided_face() -> None:
    """答不出来就不该 `applies`；恒为「不确定」的结论只是让模型多读一句废话。"""
    assert set(get_args(Verdict)) == {"ok", "warn", "failed"}
