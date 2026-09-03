"""对外面那把钥匙：铸、摘要、比对。

⚠ 这一组盯的是「明文进不了库」与「比对不泄漏前缀」两件事——两者都不会在功能
上表现出来，只会在被人盯上时才付代价（docs/MODELING_PLATFORM_DESIGN.md D13）。
"""

import ast
import inspect
import textwrap

from platform_server.apps.modeling.services import api_key

# 铸多少把来看重不重样。⚠ 重样这件事在功能上完全看不出来：两家对接方各拿一把
# 「自己的」钥匙，实际上是同一把
MINT_ROUNDS = 200


def test_a_minted_key_carries_its_namespace() -> None:
    """明文带着固定前缀，日志与扫描器靠它认出「这是一把密钥」。"""
    assert api_key.mint().plaintext.startswith(f"{api_key.KEY_NAMESPACE}_")


def test_the_visible_prefix_is_the_head_of_the_plaintext() -> None:
    """落库的前缀就是明文的头几位，界面靠它认出是哪一把。"""
    minted = api_key.mint()
    assert minted.plaintext.startswith(minted.prefix)
    assert len(minted.prefix) == api_key.KEY_PREFIX_LENGTH


def test_two_mints_never_collide() -> None:
    """两把钥匙不重样。"""
    assert len({api_key.mint().plaintext for _ in range(MINT_ROUNDS)}) == (
        MINT_ROUNDS
    )


def test_the_digest_is_a_sha256_hex() -> None:
    """摘要是 64 位十六进制——库上的 CHECK 按这个长度拦。"""
    digest = api_key.mint().digest
    assert len(digest) == 64
    assert set(digest) <= set("0123456789abcdef")


def test_a_key_matches_its_own_digest() -> None:
    """明文对得上自己的摘要。"""
    minted = api_key.mint()
    assert api_key.matches(minted.plaintext, minted.digest) is True


def test_another_key_does_not_match() -> None:
    """别的明文对不上。"""
    minted = api_key.mint()
    assert api_key.matches(api_key.mint().plaintext, minted.digest) is False


def test_the_comparison_is_constant_time() -> None:
    """比对走 `compare_digest`，不是 `==`。

    ⚠ 这一条盯的是源码不是行为：`==` 逐字节短路，耗时会泄漏前缀，而两种写法
    的功能表现一模一样，任何黑盒用例都区分不出来。
    ⚠ 断言前要**先剥掉注释与文档串**：那一行提醒「不许写 `==`」的注释本身就
    含着 `==`，不剥就是让注释骗过闸门。
    """
    body = _stripped(inspect.getsource(api_key.matches))
    assert "compare_digest" in body
    assert "==" not in body


def _stripped(source: str) -> str:
    """剥掉注释与文档串之后的源码。

    Args: source。
    """
    tree = ast.parse(textwrap.dedent(source))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            node.body = [
                item
                for item in node.body
                if not (
                    isinstance(item, ast.Expr)
                    and isinstance(item.value, ast.Constant)
                    and isinstance(item.value.value, str)
                )
            ]
    return ast.unparse(tree)


def test_a_stranger_string_is_turned_away_early() -> None:
    """长得不像的输入不必查库。"""
    assert api_key.looks_like_a_key("hello") is False
    assert api_key.looks_like_a_key("") is False
    assert api_key.looks_like_a_key(api_key.mint().plaintext) is True


def test_nothing_here_can_recover_a_plaintext() -> None:
    """本模块没有任何一处从摘要走回明文。

    ⚠ 「找回密钥」这件事在设计上就该做不到——做得到就意味着存在一个能读出
    全部密钥的接口。
    """
    source = inspect.getsource(api_key)
    assert "def recover" not in source
    assert "decrypt" not in source
