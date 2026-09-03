"""MinerU 那一路外部解析后端：PDF 与扫描件交给它（ADR-0043）。

⚠ **只声明 `.pdf` 与图片后缀，不声明 Office。** 外部那一路排在本地之前
（`registry.external_for`），声明了 `.docx` 就会把它从 `DocxParser` 手里抢走——
而本地那三路解得更准（真实的标题层级、表格结构、页眉页脚），也不花这台机器的
几十秒 CPU。

⚠ **吃 `content_list`，不吃 `md_content`。** markdown 那一份里**没有页码**，
MinerU 也没有参数能让它加。用它就等于在这一步把 `locator.page` 丢掉，而
ADR-0033 说这一格丢了后面任何一层都补不回来——表现是答得头头是道却指不出出处。

⚠ **走异步 `/tasks` 而不是 `/file_parse`。** 三页文字 PDF 在纯 CPU 上约十秒，
一份两百页的扫描件要几十分钟。同步接口意味着一条 HTTP 连接挂那么久，中间任何
一跳超时都让这次解析白跑，而 MinerU 那边仍在烧 CPU。

⚠ **不自动重试**（runtime-resilience §4）：失败即抛，由人在界面上按
「重新解析」。一条链路只有一层负责重试，而那一层是人按的那一下。

线形以 `tests/fixtures/mineru_file_parse.json` 为准——那是从真服务上抓的，
不是照文档写的。升级 MinerU 要连着重抓一次。
"""

import asyncio
import base64
import binascii
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Literal, cast

import httpx

from knowledge_server.apps.knowledge.services.parsing.ports import (
    Block,
    BlockKind,
    ExternalParseFailed,
    Figure,
    Locator,
    ParsedDocument,
    RawItem,
)
from knowledge_server.apps.knowledge.services.parsing.structure import (
    cell_text,
    paired,
    path_of,
    pushed,
)

#: 这一路在注册表里的名字。⚠ 是线上契约的一部分：`/capabilities` 报的就是它
MINERU_KIND = "mineru"

# ⚠ **必须显式给。** 服务端的缺省后端是 `hybrid-engine`，而那一档要 GPU——
# 不给的表现是「服务起着、一调就报错」，且错在服务端
_PIPELINE = "pipeline"
# 轮询间隔。⚠ 别太密：解析是分钟级的，一秒一问只是在给对方加无谓的负载
_POLL_INTERVAL_S = 2.0
# 单次 HTTP 请求的预算（投任务那一次要传整份原件，所以写得宽）
_CONNECT_TIMEOUT_S = 5.0
_REQUEST_TIMEOUT_S = 120.0
# 一份原件最多解出多少块，与本地那几路同一条口径
_MAX_BLOCKS = 20_000
# 版面框那个数组有几个数
_BBOX_LENGTH = 4
# 任务的终态
_DONE = "completed"

# 没有图注时的占位。⚠ 块的正文不许为空（`text_present` 那条 CHECK），
# 而一张没有图注的图仍然值得在引用面上摆出来
_NO_CAPTION = "（图，无图注）"
_NO_TABLE_CAPTION = "（表格截图）"


def _table_rows(html: str) -> list[list[str]]:
    """把 `table_body` 那段 HTML 拆成一行行单元格。

    Args: html。
    """
    walk = _TableWalk()
    walk.feed(html)
    walk.close()
    return walk.rows


class _TableWalk(HTMLParser):
    """只收 `tr` / `td` / `th` 的文本，别的一律丢掉。

    ⚠ 不执行任何脚本、不跟外链：这段 HTML 是外部服务产出的。
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._cells: list[str] = []
        self._buffer: list[str] = []
        self._in_cell = False

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        del attrs
        if tag == "tr":
            self._cells = []
        elif tag in ("td", "th"):
            self._in_cell = True
            self._buffer = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._in_cell:
            self._in_cell = False
            self._cells.append(cell_text("".join(self._buffer)))
        elif tag == "tr" and self._cells:
            self.rows.append(self._cells)
            self._cells = []

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._buffer.append(data)


@dataclass
class _Walk:
    """翻译一份 `content_list` 时的游标。"""

    blocks: list[Block] = field(default_factory=list[Block])
    stack: list[tuple[int, str]] = field(default_factory=list[tuple[int, str]])

    def emit(
        self,
        kind: BlockKind,
        text: str,
        page: int,
        level: int = 0,
        ref: str = "",
    ) -> None:
        """收一块；空文本与超出上限的都不收。

        Args: kind, text, page（从 1 起）, level, ref（figure 块指哪张图）。
        """
        body = text.strip()
        if not body or len(self.blocks) >= _MAX_BLOCKS:
            return
        self.blocks.append(
            Block(
                kind=kind,
                text=body,
                level=level,
                locator=Locator(page=page, path=path_of(self.stack)),
                figure_ref=ref,
            )
        )


def _mapping(value: object) -> dict[str, Any]:
    """外部 JSON 里的一个对象；不是对象就给空的。

    ⚠ 收敛只在这一处（code-style-python：`Any` 只在边界且立刻收敛）。
    每个取值点各写一次 `isinstance` 的话，漏判的那一处会在运行期抛
    AttributeError。

    Args: value。
    """
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def _strings(value: object) -> list[str]:
    """外部 JSON 里的一个字符串数组；不是数组就给空的。

    Args: value。
    """
    if not isinstance(value, list):
        return []
    return [str(one).strip() for one in cast(list[object], value)]


def _page_of(item: dict[str, Any]) -> int:
    """`page_idx` 从 0 起，我们的页码从 1 起。

    Args: item。
    """
    raw = item.get("page_idx")
    return raw + 1 if isinstance(raw, int) else 1


def _joined(item: dict[str, Any], key: str) -> str:
    """`image_caption` / `table_caption` 那种字符串数组拼成一句。

    Args: item, key。
    """
    return " ".join(one for one in _strings(item.get(key)) if one)


def _text_item(walk: _Walk, item: dict[str, Any], page: int) -> None:
    """一条 `text`：有 `text_level` 的是标题，没有的是正文。

    ⚠ 层级是 **MinerU 自己判的**，不是原件的：实测一份 PDF 里 `h1` 与 `h2`
    会一起回 `text_level=2`。所以标题栈多半是平的，`locator.path` 只到「最近
    的一个标题」——别指望完整的层级链。

    Args: walk, item, page。
    """
    body = str(item.get("text") or "")
    level = item.get("text_level")
    if isinstance(level, int) and level >= 1:
        walk.stack = pushed(walk.stack, level, body.strip())
        walk.emit("heading", body, page, level)
        return
    walk.emit("paragraph", body, page)


def _table_item(walk: _Walk, item: dict[str, Any], page: int) -> None:
    """一条 `table`：表注成 caption，表体按行摊平，表头拼进每一行。

    ⚠ 表头要拼进**每一行**：只存 `65 | 28 | ℃` 的话，检索到这一行也读不出
    它是什么——列名在表头那一行，而那一行是另一个块。

    Args: walk, item, page。
    """
    caption = _joined(item, "table_caption")
    # ⚠ 表格截图与下面那些 `table_row` 文本块**并存**：文本块负责被检索到，
    # 截图负责让人看清合并单元格那类版面——两者缺一个都不够
    walk.emit("figure", caption or _NO_TABLE_CAPTION, page, ref=_ref_of(item))
    rows = _table_rows(str(item.get("table_body") or ""))
    if not rows:
        return
    header = rows[0]
    for cells in rows[1:]:
        walk.emit("table_row", paired(header, cells), page)
    walk.emit("caption", _joined(item, "table_footnote"), page)


def _equation_item(walk: _Walk, item: dict[str, Any], page: int) -> None:
    """一条 `equation`：正文取它的 LaTeX。

    Args: walk, item, page。
    """
    walk.emit("paragraph", str(item.get("text") or ""), page)


def _ref_of(item: dict[str, Any]) -> str:
    """`img_path` 取 basename 当引用名。

    ⚠ 取 basename 而不是整条路径：回包里 `img_path` 是 `images/<sha>.jpg`，
    而 `images` 那个字典的键是 `<sha>.jpg`——两边靠 basename 对上。

    Args: item。
    """
    raw = item.get("img_path")
    return str(raw).rsplit("/", 1)[-1] if isinstance(raw, str) else ""


def _image_item(walk: _Walk, item: dict[str, Any], page: int) -> None:
    """一条 `image`：出一个 `figure` 块，正文取图注。

    ⚠ 图注要进正文：不进的话「图 1 冷却水回路示意图」这句话在库里根本不存在，
    检索不到。没有图注的图用一句占位——块的正文不许为空（`text_present`
    那条 CHECK），而一张没有图注的图仍然值得在引用面上摆出来。

    Args: walk, item, page。
    """
    caption = _joined(item, "image_caption")
    walk.emit("figure", caption or _NO_CAPTION, page, ref=_ref_of(item))


# 条目类型 → 谁来翻。⚠ 查表而不是一串 elif：多一种类型就多一层缩进，
# 而认不出的类型在这里被安静跳过正是我们要的（MinerU 会加新类型）
_HANDLERS: dict[str, Callable[[_Walk, dict[str, Any], int], None]] = {
    "text": _text_item,
    "equation": _equation_item,
    "image": _image_item,
    "table": _table_item,
}


def blocks_of(items: list[object]) -> tuple[Block, ...]:
    """把 `content_list` 翻成保结构的块序列。

    Args: items。
    """
    walk = _Walk()
    for item in items:
        one = _mapping(item)
        run = _HANDLERS.get(str(one.get("type") or ""))
        if run is not None:
            run(walk, one, _page_of(one))
    return tuple(walk.blocks)


def _figures_of(one: dict[str, Any], items: list[object]) -> tuple[Figure, ...]:
    """回包里的 `images` 解成 `Figure`，并从 `content_list` 补上页码与图注。

    ⚠ `images` 的值是**完整的 data URI**（`data:image/jpeg;base64,…`），
    不是裸 base64。当成裸的去 decode 会在头几个字节上就失败。

    ⚠ 键与 `content_list` 里的 `img_path` 靠 **basename** 对上：前者是
    `<sha>.jpg`，后者是 `images/<sha>.jpg`。

    ⚠ 解不开的那一张**跳过而不是整份失败**：一张图坏掉不该让一份两百页的
    手册摄不进来，而它在引用面上的表现是「这一段没有配图」。

    Args: one, items。
    """
    raw = one.get("images")
    if not isinstance(raw, dict):
        return ()
    meta = _figure_meta(items)
    made: list[Figure] = []
    for name, value in cast(dict[str, object], raw).items():
        content, media = _decoded(value)
        if not content:
            continue
        kind, page, caption, bbox = meta.get(
            str(name), ("image", None, "", None)
        )
        made.append(
            Figure(
                ref=str(name),
                content=content,
                media_type=media,
                kind=kind,
                page=page,
                caption=caption,
                bbox=bbox,
            )
        )
    return tuple(made)


def _decoded(value: object) -> tuple[bytes, str]:
    """一个 data URI 解成字节与 media type；解不开给空。

    Args: value。
    """
    if not isinstance(value, str) or not value.startswith("data:"):
        return (b"", "")
    head, _, payload = value.partition(",")
    media = head[len("data:") :].split(";", 1)[0] or "image/jpeg"
    try:
        return (base64.b64decode(payload, validate=True), media)
    except (ValueError, binascii.Error):
        return (b"", "")


_FigureMeta = tuple[
    Literal["image", "table"],
    int | None,
    str,
    tuple[int, int, int, int] | None,
]


def _figure_meta(items: list[object]) -> dict[str, _FigureMeta]:
    """从 `content_list` 里把每张图的种类、页码、图注与版面框收出来。

    Args: items。
    """
    made: dict[str, _FigureMeta] = {}
    for item in items:
        one = _mapping(item)
        kind = one.get("type")
        if kind not in ("image", "table"):
            continue
        ref = _ref_of(one)
        if not ref:
            continue
        key = "image_caption" if kind == "image" else "table_caption"
        made[ref] = (
            "image" if kind == "image" else "table",
            _page_of(one),
            _joined(one, key),
            _bbox_of(one),
        )
    return made


def _bbox_of(item: dict[str, Any]) -> tuple[int, int, int, int] | None:
    """版面框；给不出四个整数就当没有。

    Args: item。
    """
    raw = item.get("bbox")
    if not isinstance(raw, list):
        return None
    box = cast(list[object], raw)
    if len(box) != _BBOX_LENGTH or not all(isinstance(one, int) for one in box):
        return None
    numbers = cast(list[int], box)
    return (numbers[0], numbers[1], numbers[2], numbers[3])


def _first_result(payload: dict[str, Any]) -> dict[str, Any]:
    """回包里第一份文件那一格。

    ⚠ 一次只投一份原件，所以「第一份」就是唯一那份。投多份要连着改摄取那一层
    （一份文档一行），所以这里刻意不做多份。

    Args: payload。
    """
    results = payload.get("results")
    if not isinstance(results, dict) or not results:
        return {}
    return _mapping(next(iter(cast(dict[str, object], results).values())))


def _items_of(payload: dict[str, Any]) -> list[object]:
    """从回包里取出 `content_list`。

    ⚠ 它是**一个 JSON 字符串**，不是数组（实测 3.4.5）。当成数组用的话拿到的
    是三千多个单字符——而那一路不报错，只是切出来一份全是单字的文档。

    Args: payload。
    """
    results = payload.get("results")
    if not isinstance(results, dict) or not results:
        raise ExternalParseFailed("MinerU 没有回任何解析结果")
    files = cast(dict[str, object], results)
    first = _mapping(next(iter(files.values())))
    raw: object = first.get("content_list")
    if isinstance(raw, str):
        try:
            raw = cast(object, json.loads(raw))
        except ValueError as error:
            raise ExternalParseFailed("MinerU 回的版面清单解不开") from error
    if not isinstance(raw, list):
        raise ExternalParseFailed(
            "MinerU 这次没给版面清单；调用时要带 return_content_list=true"
        )
    return cast(list[object], raw)


def document_of(filename: str, payload: dict[str, Any]) -> ParsedDocument:
    """一份回包翻成 `ParsedDocument`。

    Args: filename, payload。
    """
    items = _items_of(payload)
    blocks = blocks_of(items)
    if not blocks:
        raise ExternalParseFailed(
            "MinerU 解出来是空的：这份原件可能是空白页或整页图片"
        )
    heading = next((one.text for one in blocks if one.kind == "heading"), "")
    return ParsedDocument(
        title=heading or filename,
        blocks=blocks,
        is_truncated=len(blocks) >= _MAX_BLOCKS,
        figures=_figures_of(_first_result(payload), items),
    )


def _reason(body: dict[str, Any]) -> str:
    """回包里那句给人看的失败原因。

    Args: body。
    """
    for key in ("error", "message"):
        one = body.get(key)
        if isinstance(one, str) and one.strip():
            return one.strip()
    return ""


def _body_of(response: httpx.Response) -> dict[str, Any]:
    """一次回应摊成 JSON；非 2xx 当场翻成这一层的异常。

    ⚠ **不能按 5xx 判失败**：MinerU 解不动时回的是 **409**，包体仍是那个任务
    信封，真正的原因在 `error` 里。按状态码段判的话，这一类会被当成「成功」
    往下走，然后在取结果那一步报一个看不懂的 KeyError。

    Args: response。
    """
    try:
        given = _mapping(cast(object, response.json()))
    except ValueError:
        given = {}
    if response.status_code >= httpx.codes.BAD_REQUEST:
        raise ExternalParseFailed(
            _reason(given) or f"MinerU 回了 HTTP {response.status_code}"
        )
    return given


@dataclass(frozen=True)
class MineruBackend:
    """把一份原件交给一台 MinerU 服务解。"""

    base_url: str
    lang: str = "ch"
    formula_enabled: bool = True
    table_enabled: bool = True
    name: str = MINERU_KIND
    # ⚠ 刻意不含 Office：外部这一路排在本地之前，声明了就会把 docx/pptx 从
    # 解得更准的本地那几路手里抢走，还要多花几十秒 CPU
    suffixes: tuple[str, ...] = (".pdf", ".png", ".jpg", ".jpeg")
    media_types: tuple[str, ...] = (
        "application/pdf",
        "image/png",
        "image/jpeg",
    )

    async def parse_remote(
        self, raw: RawItem, timeout_s: float
    ) -> ParsedDocument:
        """投任务、轮到出结果、翻成块序列。

        Args: raw, timeout_s。
        """
        deadline_s = time.monotonic() + timeout_s
        try:
            async with self._client() as client:
                task = await self._submitted(client, raw)
                await self._settled(client, task, deadline_s)
                payload = await self._fetched(client, task)
        except httpx.HTTPError as error:
            raise ExternalParseFailed(f"连不上 MinerU：{error}") from error
        return document_of(raw.filename, payload)

    def _client(self) -> httpx.AsyncClient:
        """一次解析开一个客户端。

        ⚠ 不做成长驻的：一次解析是分钟级的，开一个客户端那点开销可以忽略，
        而长驻的那一份要跟着容器一起收摊——多一条生命周期就多一处漏。
        """
        return httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(
                _REQUEST_TIMEOUT_S, connect=_CONNECT_TIMEOUT_S
            ),
        )

    def _form(self) -> dict[str, str]:
        """每次投任务都要带的那几格。"""
        return {
            # ⚠ 必须显式给：服务端缺省的 hybrid-engine 要 GPU
            "backend": _PIPELINE,
            "lang_list": self.lang,
            # ⚠ 这一格默认是 false，不要就没有页码
            "return_content_list": "true",
            # markdown 用不上，少传一份省带宽
            "return_md": "false",
            # ⚠ 这一格也默认 false：不要就没有图，而引用面上那几张图正是
            # 用户要的东西
            "return_images": "true",
            "formula_enable": str(self.formula_enabled).lower(),
            "table_enable": str(self.table_enabled).lower(),
        }

    async def _submitted(self, client: httpx.AsyncClient, raw: RawItem) -> str:
        """投一个解析任务，回它的 id。

        Args: client, raw。
        """
        media = raw.media_type or "application/octet-stream"
        body = _body_of(
            await client.post(
                "/tasks",
                data=self._form(),
                files={"files": (raw.filename, raw.content, media)},
            )
        )
        task = body.get("task_id")
        if not isinstance(task, str) or not task:
            raise ExternalParseFailed("MinerU 没有回任务号")
        return task

    async def _settled(
        self, client: httpx.AsyncClient, task: str, deadline_s: float
    ) -> None:
        """轮到这个任务有结论为止。

        ⚠ 认不出的状态按**还在跑**处理，由 `deadline_s` 兜底。反过来（认不出就
        判失败）会让对方升级一版、多一个中间状态，我们这边就把每一份文档都
        判成解析失败。

        Args: client, task, deadline_s。
        """
        while True:
            body = _body_of(await client.get(f"/tasks/{task}"))
            status = str(body.get("status") or "")
            if status == _DONE:
                return
            if status == "failed":
                raise ExternalParseFailed(_reason(body) or "MinerU 这次没解成")
            if time.monotonic() >= deadline_s:
                raise ExternalParseFailed("MinerU 没在限时内解完这份原件")
            await asyncio.sleep(_POLL_INTERVAL_S)

    async def _fetched(
        self, client: httpx.AsyncClient, task: str
    ) -> dict[str, Any]:
        """取这个任务的结果。

        ⚠ 结果那一层**没有任务信封**，只有 `{backend, version, results}`。

        Args: client, task。
        """
        return _body_of(await client.get(f"/tasks/{task}/result"))
