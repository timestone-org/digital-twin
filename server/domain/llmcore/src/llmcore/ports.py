"""模型接入的扩展点与共用词汇：一路模型长什么样、怎么取。

加一路来源 = 加一个适配器文件 + 消费方那份注册元组里一行 + 一条契约测试
（ADR-0029）。调用方只认 `ModelChoice`，不认任何适配器。

⚠ 代码里**不认任何厂商名**。端点、模型名、超时全从配置来——换供应商是改一行
配置而不是改代码（config-and-secrets §6：环境差异只能是取值不能是行为）。

⚠ 一路接不上时**不造对象、也不抛**：由调用方按「能力缺席」处理，与前端那套
ports 范式同一口径。抛在装配期会让整个服务起不来，而会话历史在没有模型时
仍然要能读。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

from langchain_core.language_models import BaseChatModel

# 对话用与看图用分两档：视觉模型的单价与延迟都高得多，混成一档等于每次
# 对话都按视觉计费
# ⚠ `summary` 单列一档不是为了换模型，是为了**换断路器**：折叠是后台性质的
# 一次调用，它连挂几次不该把用户正在说的那句话一起短路掉（断路器按
# (profile, kind) 逐格建）。端点缺省与对话档同一个，只有模型名可以单配
ModelKind = Literal["chat", "vision", "summary"]

# 全部档位。⚠ 断路器按 (profile, kind) 逐格建，靠的就是这一份
MODEL_KINDS: tuple[ModelKind, ...] = ("chat", "vision", "summary")

# 没选过时走哪一路。⚠ 是线上契约的一部分：会话里存的就是这个字面量
DEFAULT_PROFILE = "default"


@dataclass(frozen=True)
class ModelChoice:
    """这一次调用要用哪一路模型。

    ⚠ 打成一包而不是三个形参：调用面的形参上限是 5，而 `respond` 还要收
    消息、工具与增量口子。
    """

    # 看图那一档单价与延迟都高得多，混成一档等于每次对话都按视觉计费
    kind: ModelKind = "chat"
    profile: str = DEFAULT_PROFILE
    # 推理档位；`None` 表示按这一路的配置默认
    effort: str | None = None


@dataclass(frozen=True)
class ModelProfile:
    """一路模型在能力面上的样子。"""

    id: str
    label: str
    # 这一路能不能马上用。为假时前端把它灰着并指向系统页
    is_ready: bool
    has_vision: bool
    # 可选的模型代号，第一个是默认
    models: tuple[str, ...]
    # 可选的推理档位；空表示这一路没有这一档可调
    efforts: tuple[str, ...]


class ModelSource(Protocol):
    """按选择取一个模型。

    ⚠ 是**异步**的：订阅账号那一路要先拿一个此刻能用的令牌，而那可能触发一次
    续期——同步的话，续期只能在事件循环里阻塞地等一次网络往返。
    """

    async def __call__(self, choice: ModelChoice) -> BaseChatModel: ...


@runtime_checkable
class ModelAdapter(Protocol):
    """一路模型来源。

    ⚠ `supports` 要**如实**回答。答错的代价不是报错而是静默错付：一路不接图的
    模型收到图片块，多半只回一句「我没看到图」，而调用照样成功、照样计费。
    """

    @property
    def id(self) -> str:
        """这一路的档位名。⚠ 声明成只读属性而不是可写字段：实现一律是冻结
        dataclass，而冻结字段满足不了一个可写的协议成员。"""
        ...

    def supports(self, kind: ModelKind) -> bool:
        """这一路吃不吃这一档。

        Args: kind。
        """
        ...

    async def build(self, choice: ModelChoice) -> BaseChatModel:
        """按这次选择造一个可调用的模型。

        ⚠ 只在 `supports` 为真时才会被调到；由注册表把关。

        Args: choice。
        """
        ...

    def profile(self) -> ModelProfile:
        """这一路在能力面上的样子。"""
        ...


@runtime_checkable
class EmbeddingAdapter(Protocol):
    """一路嵌入来源。长期记忆按它把文本转成向量（ADR-0030 决策五）。

    ⚠ 与 `ModelAdapter` 分开而不是当成 `ModelKind` 的又一档：它返回的是向量
    不是 `BaseChatModel`，单价与上下文形状也都不同。混成一档等于每次 remember
    都按对话档计费。

    ⚠ 档位名（`id`）与维数都要如实报出去：它们是**要落库对账**的，
    换了嵌入模型而维数变了的话，旧条目与新条目算不出有意义的余弦。
    """

    @property
    def id(self) -> str:
        """这一路嵌入来源的名字。"""
        ...

    @property
    def dimensions(self) -> int:
        """向量维数。

        ⚠ 落库前要靠它核对：换了嵌入模型而维数变了的话，旧条目与新条目算不出
        有意义的余弦，而表现只是「召回变差了」。
        """
        ...

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """把一批文本转成向量，顺序与入参一一对应。

        Args: texts。
        """
        ...
