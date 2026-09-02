"""这套部署接了哪几路模型，以及按 (档位, 用途) 取出其中一路。

⚠ **档位就是供应商**（ADR-0040）：目录里开着的每一路各是一个档位，档位名就是
那一路的 id；目录里缺哪一种形态，就由环境变量里配的那一路顶上（档位名
`default` / `codex`）。会话行上存的是档位名，故它可能是一个 uuid，也可能是
那两个字面量之一。

⚠ 取模型是**异步**的：订阅账号那一路要先拿一个此刻能用的令牌，而那可能触发
一次续期。做成同步的话，续期只能在事件循环里阻塞地等一次网络往返。

⚠ 认不出的档位名一律退回第一路，而不是抛：会话里存着的那一个可能是上一版
配置留下的，那时正确的行为是照常能说话，不是整个会话打不开。

⚠ **档位认得出，不代表这一档吃得下这次调用。** 一路不接图的模型收到图片块时
不会报错——它多半只回一句「我没看到图」，而调用照样成功、照样计费。所以
`supports` 为假时在这里**如实拒绝**，别让它出门。

⚠ 装配是跟着目录版本走的：目录变了才重装（`adapters()` 里那一格缓存）。每次
都重装的话，一个回合里的每一次调用都会造一批新对象；从不重装的话，改了配置
要重启才生效。
"""

from collections.abc import Collection

from langchain_core.language_models import BaseChatModel

from ai_assistant.llm.adapters import (
    AdapterDeps,
    CodexOAuthAdapter,
    build_adapters,
)
from ai_assistant.llm.errors import ModelDisabled, ModelRejected
from ai_assistant.llm.ports import (
    DEFAULT_PROFILE,
    PURPOSE_CHAT,
    ModelAdapter,
    ModelChoice,
    ModelKind,
    ModelProfile,
)
from llmcore import EMPTY_CATALOG, ModelCatalog


class ModelRegistry:
    """按档位名取模型。一个进程一份。"""

    def __init__(self, deps: AdapterDeps) -> None:
        """Args: deps（配置、订阅账号的凭据面、模型目录）。"""
        self._deps = deps
        self._built: tuple[str, tuple[ModelAdapter, ...]] | None = None

    async def refresh(self) -> None:
        """目录过了 TTL 就重拉一次。⚠ 每个异步入口先调它：`profiles()` 与
        `resolve()` 读的都是目录的快照，不刷新的话改了分配永远看不见。"""
        if self._deps.catalog is not None:
            await self._deps.catalog.refresh()

    def adapters(self) -> tuple[ModelAdapter, ...]:
        """此刻接得上的全部来源，不问那一路能不能马上用。

        ⚠ 断路器按这一份建，而它会随目录变——所以那一份要按需生长
        （`llm/breakers.py`），不能在启动时一次建完。
        """
        catalog = self._catalog()
        if self._built is None or self._built[0] != catalog.version:
            self._built = (catalog.version, build_adapters(self._deps))
        return self._built[1]

    def profiles(self) -> tuple[ModelProfile, ...]:
        """这套部署此刻接得上哪几路。解不出对话端点的一路不出现在清单里。"""
        return tuple(
            one.profile() for one in self.adapters() if one.supports("chat")
        )

    def login_refs(self) -> tuple[str, ...]:
        """要先登录一次才用得了的那几路的档位名。

        ⚠ 凭据面按它认路：登录接口收到一个不在这里的名字时该回 404，
        而不是建出一行永远没有人读的凭据。
        """
        return tuple(one.id for one in self.adapters() if _is_login_based(one))

    def default_id(self, *, ready_ids: Collection[str] | None = None) -> str:
        """没选过时用哪一路：目录里给「对话」这个用途分配的那一路优先，
        没分配时优先包月的那一路。

        ⚠ 没分配时**别默认烧钱**：订阅那一路是包月的，端点那一路按 token 计费。
        说不清走哪一路时挑后者，等于每一条新会话都在替部署方花钱，
        而那笔账要到月底才看得见。

        ⚠ 「配了」不等于「能用」——订阅那一路还得登录过，而登录状态在库里、
        这一层看不见，所以由调用方把此刻真能用的档位传进来。把默认钉在一个
        点了就报错的选项上，等于整套助手开箱即坏。

        Args: ready_ids（此刻真能用的档位名；不给则只按配置判断）。
        """
        listed = [one.id for one in self.profiles()]
        usable = [
            one for one in listed if ready_ids is None or one in ready_ids
        ]
        # 一路都不可用时仍从在册的里挑：那时整个助手都发不出回合，
        # 界面要的是「有这么一路、它没登录」，而不是一个空档位名
        chosen = usable or listed
        assigned = self._assigned_chat_id()
        if assigned is not None and assigned in chosen:
            return assigned
        by_id = {one.id: one for one in self.adapters()}
        flat_rate = next(
            (one for one in chosen if _is_login_based(by_id[one])), None
        )
        if flat_rate is not None:
            return flat_rate
        return chosen[0] if chosen else DEFAULT_PROFILE

    def resolves(self, profile_id: str) -> bool:
        """这个档位名此刻取得出模型吗。

        Args: profile_id。
        """
        return any(one.id == profile_id for one in self.adapters())

    def supports(self, profile_id: str, kind: ModelKind) -> bool:
        """这一路吃不吃这一档。认不出的档位名按退回的那一路算。

        Args: profile_id, kind。
        """
        adapter = self._adapter_of(profile_id)
        return adapter is not None and adapter.supports(kind)

    async def resolve(self, choice: ModelChoice) -> BaseChatModel:
        """按选择取一路模型。

        ⚠ 认不出的名字退回第一路：会话里存的名字可能来自上一版配置。
        ⚠ 这一路连对话档都解不出时抛 `ModelDisabled`：那是「没接模型」，
        不是「发错了」。吃对话档却不吃这一档时**抛 `ModelRejected`**：那一档
        不打开断路器，因为这不是下游不行、是我们发错了（`errors.py`）。

        Args: choice。
        """
        await self.refresh()
        adapter = self._adapter_of(choice.profile)
        if adapter is None or not adapter.supports("chat"):
            raise ModelDisabled("本部署没有接模型")
        if not adapter.supports(choice.kind):
            raise ModelRejected(_refusal(adapter.profile().label, choice.kind))
        return await adapter.build(choice)

    def _adapter_of(self, profile_id: str) -> ModelAdapter | None:
        """按档位名取适配器；认不出就退回第一路，一路都没有时给 `None`。

        Args: profile_id。
        """
        listed = self.adapters()
        for one in listed:
            if one.id == profile_id:
                return one
        return listed[0] if listed else None

    def _catalog(self) -> ModelCatalog:
        """此刻的目录快照；没接目录时是空的那一份。"""
        source = self._deps.catalog
        return EMPTY_CATALOG if source is None else source.snapshot()

    def _assigned_chat_id(self) -> str | None:
        """目录里「对话」这个用途指着哪一路；没分配给 `None`。"""
        assigned = self._catalog().assigned(PURPOSE_CHAT)
        return None if assigned is None else assigned.provider_id


def _is_login_based(adapter: ModelAdapter) -> bool:
    """这一路要不要先登录一次。

    ⚠ 问的是适配器自己而不是形态码：形态码在目录里，而环境变量配出来的那一路
    根本不在目录里，按码问会把它漏掉。

    Args: adapter。
    """
    return isinstance(adapter, CodexOAuthAdapter)


# 每一档被拒时该给的下一步。⚠ 查表而不是一串 if：加一档 `ModelKind` 时，
# 漏了这里只会退回那句泛泛的兜底，而不是让某个分支永远走不到
_REFUSAL_HINTS: dict[str, str] = {
    "vision": "换到一路登记了接图模型的供应商，或者这一轮别截图",
}


def _refusal(label: str, kind: ModelKind) -> str:
    """拒绝这次调用的那句话。

    ⚠ 要说清**下一步能干什么**：只说「不支持」的话，模型会原样再试一次，
    而每一次都要走完一个回合才失败。

    Args: label（那一路在界面上的名字）, kind。
    """
    hint = _REFUSAL_HINTS.get(kind, "换一路模型，或者这一轮别用这一档")
    told = "不接图" if kind == "vision" else f"不吃 {kind} 这一档"
    return f"「{label}」这一路{told}；{hint}"
