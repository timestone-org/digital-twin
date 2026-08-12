#!/usr/bin/env python3
"""闸门脚本的共用件：违规记录、源码遍历与统一的命令行出口。

每个 `check_*.py` 只声明自己的 CHECKS，报告格式与退出码由这里统一，
避免十来个闸门各印各的格式。闸门与规范条目的对照见 docs/agents/ci-gates.md。
"""

from __future__ import annotations

import ast
import io
import os
import re
import subprocess
import sys
import tokenize
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "server"
SERVICES = SERVER / "services"
WEB = ROOT / "web"

# 依赖、构建产物与缓存不参与任何闸门
SKIP_PARTS = frozenset(
    {
        ".git",
        ".venv",
        "node_modules",
        "dist",
        "coverage",
        "__pycache__",
        ".pytest_cache",
        ".ruff_cache",
        ".mypy_cache",
        ".vite",
        "htmlcov",
    }
)

PY = frozenset({".py"})
TS = frozenset({".ts", ".tsx", ".vue"})
STYLE = frozenset({".css", ".scss", ".sass"})


@dataclass(frozen=True)
class Violation:
    """一条违规：命中的规则、位置、以及命中的具体内容。"""

    rule: str
    where: str
    detail: str


Check = Callable[[], list[Violation]]
FuncDef = ast.FunctionDef | ast.AsyncFunctionDef


def is_skipped(path: Path) -> bool:
    return bool(SKIP_PARTS & set(path.parts))


def iter_files(root: Path, suffixes: frozenset[str]) -> Iterator[Path]:
    """遍历 root 下指定后缀的文件，跳过依赖与产物目录。

    Args: root, suffixes。
    """
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix in suffixes and not is_skipped(path):
            yield path


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def at(path: Path, line: int | None = None) -> str:
    """把绝对路径压成仓库相对路径，可选带行号。

    Args: path, line。
    """
    text = str(path.relative_to(ROOT))
    return f"{text}:{line}" if line else text


def parse(path: Path) -> ast.Module | None:
    """解析成 AST；语法错误交给 ruff / pyright 去报，这里跳过。

    Args: path。
    """
    try:
        return ast.parse(read(path), filename=str(path))
    except SyntaxError:
        return None


def functions(tree: ast.AST) -> Iterator[FuncDef]:
    """遍历模块内全部函数与方法定义（含嵌套）。

    Args: tree。
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            yield node


def service_dirs() -> list[Path]:
    """全部服务目录（`server/services/<svc>/`）。"""
    if not SERVICES.is_dir():
        return []
    return sorted(p for p in SERVICES.iterdir() if p.is_dir())


def python_production_roots() -> list[Path]:
    """被测代码的根：lib、domain 与各服务的 src。"""
    roots = [SERVER / "lib" / "src", SERVER / "domain"]
    roots.extend(service / "src" for service in service_dirs())
    return [root for root in roots if root.is_dir()]


def python_test_roots() -> list[Path]:
    """测试代码的根。"""
    roots = [SERVER / "lib" / "tests"]
    roots.extend(service / "tests" for service in service_dirs())
    return [root for root in roots if root.is_dir()]


def python_tool_roots() -> list[Path]:
    """闸门与服务脚本——它们同样守本仓的风格规范。"""
    roots = [ROOT / "scripts"]
    roots.extend(service / "scripts" for service in service_dirs())
    return [root for root in roots if root.is_dir()]


def python_sources() -> Iterator[Path]:
    """生产代码 + 脚本。测试另有自己的闸门，不混进来。"""
    for root in [*python_production_roots(), *python_tool_roots()]:
        yield from iter_files(root, PY)


def python_tests() -> Iterator[Path]:
    for root in python_test_roots():
        yield from iter_files(root, PY)


def web_members() -> list[Path]:
    """前端 workspace 的成员：应用壳与各个包。"""
    found = [WEB / "app"] if (WEB / "app").is_dir() else []
    packages = WEB / "packages"
    if packages.is_dir():
        found.extend(p for p in sorted(packages.iterdir()) if p.is_dir())
    return found


def web_sources() -> Iterator[Path]:
    for member in web_members():
        yield from iter_files(member / "src", TS)


def web_tests() -> Iterator[Path]:
    for member in web_members():
        yield from iter_files(member / "tests", TS)


_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_LINE_COMMENT = re.compile(r"^\s*//.*$", re.M)


def strip_ts_comments(text: str) -> str:
    """去掉 TS/Vue 的注释，只留正文。注释里引用规则本身不算违规。

    Args: text。
    """
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", text))


def strip_python_comments(text: str) -> str:
    """去掉 Python 源码里的 `#` 注释与空行，只留代码。

    ⚠ 只去 `#` 注释，**不去 docstring**：docstring 会被程序读走（帮助文本、
    契约描述），当成散文抹掉就是一处静默的假阴性。
    ⚠ 必须连空行一起去：注释独占一行时抹掉只剩空行，加一条注释就会让两侧
    差出一个换行，比较结果又变成「改了」。
    ⚠ 词法分析不了就原样返回——按「有改动」处理，宁可误报不可漏报。
    Args: text。
    """
    lines = text.splitlines()
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (SyntaxError, tokenize.TokenError, IndentationError):
        return text
    for token in tokens:
        if token.type == tokenize.COMMENT:
            row, column = token.start
            lines[row - 1] = lines[row - 1][:column]
    return "\n".join(kept for line in lines if (kept := line.rstrip()))


def python_comments(path: Path) -> Iterator[tuple[int, str]]:
    """产出 Python 源码里真正的注释（行号, 原文），含行尾注释。

    ⚠ 必须走 tokenize 而不是扫 `#`：字符串字面量里出现 `# noqa` 这类文本
    会被逐行扫描当成真注释，闸门于是对自己的说明文案报违规。
    Args: path。
    """
    try:
        with path.open(encoding="utf-8") as handle:
            for token in tokenize.generate_tokens(handle.readline):
                if token.type == tokenize.COMMENT:
                    yield token.start[0], token.string
    except (SyntaxError, tokenize.TokenError, UnicodeDecodeError):
        return


def python_prose(path: Path) -> Iterator[tuple[int, str]]:
    """产出 Python 源码里的「散文」：注释 + docstring 的每一行。

    ⚠ 不能整份文件逐行扫：正则与文案本身会把闸门自己的定义算成违规。
    Args: path。
    """
    yield from python_comments(path)
    tree = parse(path)
    if tree is None:
        return
    for node in ast.walk(tree):
        if not isinstance(node, ast.Expr):
            continue
        value = node.value
        if not isinstance(value, ast.Constant) or not isinstance(
            value.value, str
        ):
            continue
        for offset, line in enumerate(value.value.splitlines()):
            yield node.lineno + offset, line


def comment_lines(path: Path) -> Iterator[tuple[int, str]]:
    """产出 TS/Vue/样式源文件里的注释行（行号, 内容）。

    Args: path。
    """
    for number, line in enumerate(read(path).splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith(("//", "*", "/*", "<!--")):
            yield number, stripped


# `<脚本> <base> <head>` —— 取参数要有这么多个
_BASE_ARG = 2
_HEAD_ARG = 3


def git(*args: str) -> str:
    """跑一条 git 命令取标准输出；跑不成给空串。

    Args: args。
    """
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip()


def diff_base() -> str:
    """比较基线：命令行第一个参数 > `PR_BASE_REF` > `origin/main`。"""
    if len(sys.argv) >= _BASE_ARG:
        return sys.argv[1]
    return os.environ.get("PR_BASE_REF", "origin/main")


def diff_head() -> str:
    """比较的另一头：命令行第二个参数 > `PR_HEAD_REF` > `HEAD`。"""
    if len(sys.argv) >= _HEAD_ARG:
        return sys.argv[2]
    return os.environ.get("PR_HEAD_REF", "HEAD")


def diff_range() -> str:
    return f"{diff_base()}...{diff_head()}"


def ref_exists(ref: str) -> bool:
    """这个引用在本地解析得出提交吗。

    ⚠ 解析不出来时 `git diff` 只是给空输出，闸门会当成「什么都没改」而长绿；
    要基线的闸门必须先问这一句。
    Args: ref。
    """
    return bool(git("rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"))


def changed_files() -> list[str]:
    """基线到头之间改过的文件，仓库相对路径。"""
    output = git("diff", "--name-only", diff_range())
    return [line for line in output.splitlines() if line]


def file_at(ref: str, path: str) -> str | None:
    """某个提交里这份文件的内容；那时还没有这个文件就给 None。

    Args: ref, path。
    """
    if not git("ls-tree", "-r", "--name-only", ref, "--", path):
        return None
    return git("show", f"{ref}:{path}")


def main(title: str, checks: Sequence[Check]) -> int:
    """跑一组检查；有违规就逐条打印并以非零码退出。

    Args: title, checks。
    """
    violations: list[Violation] = []
    for check in checks:
        violations.extend(check())
    if not violations:
        sys.stdout.write(f"{title}通过（{len(checks)} 项）\n")
        return 0
    for item in violations:
        sys.stderr.write(f"[{item.rule}] {item.where} → {item.detail}\n")
    sys.stderr.write(f"\n{title}：共 {len(violations)} 处违规\n")
    return 1
