"""原件的 media type：按后缀查一张显式的表。

⚠ **不用 `mimetypes.guess_type`**：标准库那一路会去读 `/etc/mime.types` 一类的
系统文件，于是同一份 `.md` 在开发机上是 `text/markdown`、在精简过的容器里是
`application/octet-stream`——而表现是「预览在本机好好的，部署上去变成了下载」，
两边的代码却逐字相同。

⚠ 认不出的一律给 `application/octet-stream`，**不猜**：猜错的代价是浏览器按错
的类型去渲染（把一份 .docx 当 HTML 摊开是一屏乱码），而如实给通用类型只让界面
走到「这个格式看不了，下载吧」那一档。

⚠ 表里没有 `image/svg+xml`：SVG 是可执行的（它能带 `<script>`），而这条端点吐
的是用户传上来的字节。收了它就等于在本站域名下开了一个任人上传的脚本落点。
"""

# 后缀 → media type。⚠ 与 `parsing/` 各路后端声明的 `suffixes` 同源：那边收得
# 进来、这边却查不到类型的话，预览面只能一律走「下载」那一档
_BY_SUFFIX: dict[str, str] = {
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".text": "text/plain; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".docx": (
        "application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document"
    ),
    ".xlsx": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ),
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".pptx": (
        "application/vnd.openxmlformats-officedocument"
        ".presentationml.presentation"
    ),
}

#: 认不出时给的通用类型。
FALLBACK_MEDIA_TYPE = "application/octet-stream"

# 允许在浏览器里**当场摊开**的类型。⚠ 是白名单而不是黑名单，而且 `text/html`
# **故意不在里面**：这条端点在本站域名下，把用户传上来的 HTML 以 inline 摊开，
# 那份 HTML 里的脚本就跑在本站源上，能读到这个源的存储、能替用户调接口——
# 一次上传就是一次存储型 XSS。页面里的预览另有安全的画法（沙箱 iframe），
# 而直接在地址栏打开这条端点的人拿到的是「下载」。
_INLINE_SAFE = frozenset(
    {
        "application/pdf",
        "image/png",
        "image/jpeg",
        "text/plain",
        "text/markdown",
        "application/json",
    }
)


def media_type_of(suffix: str) -> str:
    """按后缀查它的 media type；查不到给通用类型。

    Args: suffix（带点的小写后缀，`sources.suffix_of` 的产物）。
    """
    return _BY_SUFFIX.get(suffix.lower(), FALLBACK_MEDIA_TYPE)


def is_inline_safe(media_type: str) -> bool:
    """这个类型可以让浏览器当场摊开吗。

    ⚠ 只比对分号前那一段：`text/plain; charset=utf-8` 与 `text/plain` 是同一件
    事，连着参数一起比的话白名单里的每一条都要写两遍，而漏写的那一条会安静地
    掉进「下载」档。

    Args: media_type。
    """
    return media_type.split(";", 1)[0].strip().lower() in _INLINE_SAFE
