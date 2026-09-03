"""llmcore 各层的扩展点形状（ADR-0029 / ADR-0037）。

守三件靠评审记不住的事：再导出面漏名（别的模块于是直接伸进子模块）、
Protocol 忘了 `runtime_checkable`（注册表要靠它逐个校验实现）、以及
**这一份不许沾任何产品名词**——沾了就等于把两个消费方之一写死进了 domain。
"""

import importlib
import pathlib
from types import ModuleType

import pytest

# llmcore 的层包。⚠ 显式列出而不是扫目录：扫出来的名单会把将来某个忘了
# `__init__.py` 的目录悄悄漏掉，而漏掉的那一层的闸就此不跑
LAYERS = ("turn", "tools", "output", "intent", "reflection", "rerank")

# 这几个是 Protocol，注册表要靠 `isinstance` 逐个校验注册进来的实现
PROTOCOLS = (
    ("turn", "Responder"),
    ("tools", "ToolProvider"),
    ("reflection", "Verifier"),
    ("rerank", "Reranker"),
)

# ⚠ 产品名词的黑名单。domain 层沾上任何一个，就等于把两个消费方之一写死进来：
# 知识库用一个日志名叫 `assistant.turn` 的引擎时，日志会谎报出处
FORBIDDEN = ("ai_assistant", "knowledge_server")

SRC = pathlib.Path(__file__).resolve().parents[2] / "src" / "llmcore"


def _package(layer: str) -> ModuleType:
    return importlib.import_module(f"llmcore.{layer}")


@pytest.mark.parametrize("layer", LAYERS)
def test_every_reexported_name_actually_resolves(layer: str) -> None:
    """`__all__` 里写错的名字只在 `import *` 时才炸，平时一声不吭。"""
    package = _package(layer)
    listed: list[str] = list(vars(package).get("__all__", []))
    missing = [name for name in listed if not hasattr(package, name)]
    assert missing == []


@pytest.mark.parametrize(("layer", "name"), PROTOCOLS)
def test_every_protocol_is_runtime_checkable(layer: str, name: str) -> None:
    """注册表要靠 `isinstance` 校验实现，漏了这个装饰器它就校验不动。"""
    found = getattr(_package(layer), name)
    assert getattr(found, "_is_runtime_protocol", False)


def test_the_engine_never_imports_either_consumer() -> None:
    """⚠ domain 不许 import 服务：import 得动就说明它已经不通用了。"""
    guilty = [
        str(path.relative_to(SRC))
        for path in SRC.rglob("*.py")
        for word in FORBIDDEN
        if f"import {word}" in path.read_text(encoding="utf-8")
        or f"from {word}" in path.read_text(encoding="utf-8")
    ]
    assert guilty == []


def test_no_logger_or_event_name_is_branded_with_one_consumer() -> None:
    """⚠ 日志名写死某一家，另一家的日志就在谎报出处。

    这条逮的是真事：抽取时 `turn/loop.py` 的 logger 一路叫着 `assistant.turn`
    跟了过来，而知识库用它时日志里会写着 assistant。
    """
    branded = [
        str(path.relative_to(SRC))
        for path in SRC.rglob("*.py")
        if 'get_logger("assistant' in path.read_text(encoding="utf-8")
        or 'get_logger("knowledge' in path.read_text(encoding="utf-8")
    ]
    assert branded == []
