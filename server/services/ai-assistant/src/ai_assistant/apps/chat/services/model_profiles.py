"""这套部署接了哪几路模型、此刻默认走哪一路。

⚠ 「配了」不等于「能用」：要登录的那几路还得先登录过，而登录态在库里，
只按配置答不出来——所以这两问都要开一次库。

⚠ 要登录的是**哪几路**由注册表说了算，不是一个写死的档位名：目录里可以配出
好几路订阅账号，各自一份登录态（ADR-0040）。

⚠ 能力面与建会话共用这一份判定。各写一份的话，界面上摆着的那一路与会话
真正走的那一路会各自漂开，而漂开的表现是「显示订阅账号、实际按量计费」：
除了账单，运行期一点迹象都没有。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from ai_assistant.apps.chat.schemas.capability import ModelProfileOut
from ai_assistant.llm import ModelRegistry


class LoginState(Protocol):
    """登录态里这一层用得到的那一格。"""

    @property
    def is_connected(self) -> bool: ...


class LoginProbe(Protocol):
    """问一路模型登没登录。

    ⚠ 收窄成这一问而不是直接收凭据面：这一层只该看得见「登没登录」，
    看得见令牌的话，迟早有人在这里顺手把它摊进出参。
    """

    async def status(self, provider: str) -> LoginState: ...


@dataclass(frozen=True)
class ModelDefaults:
    """新会话开箱走哪一路、哪一档。"""

    profile: str
    # 这一路没有推理档位时是 `None`：按量那一路吃不到这一格，盖上去等于在
    # 行上记一件不会发生的事
    effort: str | None


async def profiles_of(
    models: ModelRegistry, credentials: LoginProbe | None
) -> list[ModelProfileOut]:
    """这套部署接了哪几路，各自此刻能不能用。

    ⚠ 要登录的那几路的「能不能用」要**去库里看有没有登录过**：只按配置回答的话，
    界面上会摆出一个点了就报错的选项，而报出来的错是「模型暂时不可用」。

    Args: models, credentials（凭据面；没接要登录的那些路时是 None）。
    """
    # ⚠ 先让目录刷新：每一路「此刻能不能用」读的是目录快照，不刷新的话
    # 界面上分配了新模型、这里报的还是旧的
    await models.refresh()
    login = models.login_refs()
    connected = await _connected(models, credentials)
    return [
        ModelProfileOut(
            id=one.id,
            label=one.label,
            is_ready=(one.id in connected if one.id in login else one.is_ready),
            has_vision=one.has_vision,
            models=list(one.models),
            efforts=list(one.efforts),
        )
        for one in models.profiles()
    ]


def default_id_of(
    models: ModelRegistry, profiles: Sequence[ModelProfileOut]
) -> str:
    """这几路里此刻该默认走哪一路。

    Args: models, profiles（各自此刻能不能用）。
    """
    ready = [one.id for one in profiles if one.is_ready]
    return models.default_id(ready_ids=ready)


async def defaults_of(
    models: ModelRegistry, credentials: LoginProbe | None, *, effort: str
) -> ModelDefaults:
    """建会话时该盖到行上的那一路与那一档。

    Args: models, credentials, effort（部署配的推理档位默认）。
    """
    listed = await profiles_of(models, credentials)
    chosen = default_id_of(models, listed)
    found = next((one for one in listed if one.id == chosen), None)
    has_effort = found is not None and len(found.efforts) > 0
    return ModelDefaults(profile=chosen, effort=effort if has_effort else None)


async def _connected(
    models: ModelRegistry, credentials: LoginProbe | None
) -> frozenset[str]:
    """要登录的那几路里，此刻真登录过的。

    Args: models, credentials。
    """
    if credentials is None:
        return frozenset()
    found = [
        one
        for one in models.login_refs()
        if (await credentials.status(one)).is_connected
    ]
    return frozenset(found)
