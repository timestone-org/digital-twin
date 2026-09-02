"""这套部署接了哪几路模型，以及按 (档位, 用途) 取出其中一路。

⚠ 取模型是**异步**的：订阅账号那一路要先拿一个此刻能用的令牌，而那可能触发
一次续期。做成同步的话，续期只能在事件循环里阻塞地等一次网络往返。

⚠ 认不出的档位名一律退回第一路，而不是抛：会话里存着的档位名可能是上一版
配置留下的，那时正确的行为是照常能说话，不是整个会话打不开。

⚠ **档位认得出，不代表这一档吃得下这次调用。** 一路不接图的模型收到图片块时
不会报错——它多半只回一句「我没看到图」，而调用照样成功、照样计费。所以
`supports` 为假时在这里**如实拒绝**，别让它出门。

⚠ 按量那一路的端点来自运行期可改的目录（ADR-0039）：`profiles()` 报的是
**此刻**解得出端点的那几路，`adapters()` 才是装配了的全部。断路器按后者建，
能力面按前者报——用前者建断路器的话，目录还没拉到时这一路就永远没有断路器。
"""

from collections.abc import Collection

from langchain_core.language_models import BaseChatModel

from ai_assistant.llm.adapters import AdapterDeps, build_adapters
from ai_assistant.llm.errors import ModelDisabled, ModelRejected
from ai_assistant.llm.ports import (
    CODEX_PROFILE,
    DEFAULT_PROFILE,
    ModelAdapter,
    ModelChoice,
    ModelKind,
    ModelProfile,
)


class ModelRegistry:
    """按档位名取模型。一个进程一份。"""

    def __init__(self, deps: AdapterDeps) -> None:
        """Args: deps（配置、订阅账号的凭据面、模型目录）。"""
        self._deps = deps
        self._adapters = build_adapters(deps)

    async def refresh(self) -> None:
        """目录过了 TTL 就重拉一次。⚠ 每个异步入口先调它：`profiles()` 与
        `resolve()` 读的都是目录的快照，不刷新的话改了分配永远看不见。"""
        if self._deps.catalog is not None:
            await self._deps.catalog.refresh()

    def adapters(self) -> tuple[ModelAdapter, ...]:
        """装配了的全部来源，不问此刻能不能用。断路器按这一份建。"""
        return self._adapters

    def profiles(self) -> tuple[ModelProfile, ...]:
        """这套部署此刻接得上哪几路。解不出对话端点的一路不出现在清单里。"""
        return tuple(
            one.profile() for one in self._adapters if one.supports("chat")
        )

    def default_id(self, *, ready_ids: Collection[str] | None = None) -> str:
        """没选过时用哪一路：订阅那一路在册就选它，否则退按量。

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
        if CODEX_PROFILE in chosen:
            return CODEX_PROFILE
        return chosen[0] if chosen else DEFAULT_PROFILE

    def resolves(self, profile_id: str) -> bool:
        """这个档位名此刻取得出模型吗。

        Args: profile_id。
        """
        return any(one.id == profile_id for one in self._adapters)

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
            raise ModelRejected(_refusal(adapter.id, choice.kind))
        return await adapter.build(choice)

    def _adapter_of(self, profile_id: str) -> ModelAdapter | None:
        """按档位名取适配器；认不出就退回第一路，一路都没有时给 `None`。

        Args: profile_id。
        """
        for one in self._adapters:
            if one.id == profile_id:
                return one
        return self._adapters[0] if self._adapters else None


# 每一档被拒时该给的下一步。⚠ 查表而不是一串 if：加一档 `ModelKind` 时，
# 漏了这里只会退回那句泛泛的兜底，而不是让某个分支永远走不到
_REFUSAL_HINTS: dict[str, str] = {
    "vision": "换到按量计费那一路，或者这一轮别截图",
}


def _refusal(profile_id: str, kind: ModelKind) -> str:
    """拒绝这次调用的那句话。

    ⚠ 要说清**下一步能干什么**：只说「不支持」的话，模型会原样再试一次，
    而每一次都要走完一个回合才失败。

    Args: profile_id, kind。
    """
    hint = _REFUSAL_HINTS.get(kind, "换一路模型，或者这一轮别用这一档")
    label = "不接图" if kind == "vision" else f"不吃 {kind} 这一档"
    return f"「{profile_id}」这一路{label}；{hint}"
