"""上传来源：原件是用户传进对象存储的那些字节。

⚠ 它**不自己发现条目**：字节是浏览器直传上去的，而「传了哪些」由 api 侧在
确认那一步登记成文档行。所以 `discover` 恒返回空页——这一路的条目由外部推进来，
不是由我们拉出来的。

⚠ 那不是把接口用歪了：`KnowledgeSource` 的两个动作里，`fetch` 是这一路真正
要干的活（把字节取回来交给解析层），而 `discover` 只对「我们主动去拉」的来源
有意义。给它一个诚实的空实现，好过给上传开一条绕过接口的后门。
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.sources.ports import (
    DiscoveredPage,
    SourceUnavailable,
)
from lib.objectstore import ObjectNotFound, ObjectStore, ObjectStoreError

#: 这一路在注册表里的名字。⚠ 是线上契约的一部分：来源行上存的就是它
UPLOAD_KIND = "upload"

# 配置里认得的键。⚠ 上传这一路没有可配的东西——留一个空 schema 而不是不实现，
# 是为了让「这一路要配什么」在界面上有一个统一的问法
_SCHEMA: Mapping[str, Any] = {"type": "object", "properties": {}}


@dataclass(frozen=True)
class UploadSource:
    """把对象存储里的一个键取回来。"""

    store: ObjectStore
    kind: str = UPLOAD_KIND

    def config_schema(self) -> Mapping[str, Any]:
        """这一路没有可配项。"""
        return _SCHEMA

    async def discover(
        self, config: Mapping[str, Any], cursor: str | None
    ) -> DiscoveredPage:
        """恒空：这一路的条目由用户直传推进来，不是我们拉出来的。

        Args: config, cursor。
        """
        del config, cursor
        return DiscoveredPage(items=(), cursor=None)

    async def fetch(self, config: Mapping[str, Any], ref: str) -> RawItem:
        """按对象键把字节取回来。

        ⚠ 取不到分两档：键不存在是「这份文档的原件没了」（不可重试，
        多半是有人清了桶），别的存储错是「此刻拿不到」（重试有意义）。
        混成一档的话，前者会被无限重试。

        Args: config, ref（对象键）。
        """
        del config
        try:
            stat = await self.store.stat(ref)
            content = await self.store.get_bytes(ref)
        except ObjectNotFound as error:
            raise FileNotFoundError(f"原件已不在对象存储里：{ref}") from error
        except ObjectStoreError as error:
            raise SourceUnavailable("对象存储暂时不可用") from error
        return RawItem(
            # ⚠ 键的最后一段带着净化过的后缀（`keys.py`），而后缀是解析器分派
            # 的唯一判据。用文档行上的显示名反而不安全：那是用户给的字符串
            filename=ref.rsplit("/", 1)[-1],
            media_type="" if stat is None else stat.content_type,
            content=content,
        )
