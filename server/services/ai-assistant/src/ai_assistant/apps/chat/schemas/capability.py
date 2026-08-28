"""能力探测的出参：这套助手此刻到底能干什么。"""

from pydantic import BaseModel, ConfigDict, Field


class SkillOut(BaseModel):
    """一个技能在清单上的样子。正文（指令）不出这道门。"""

    model_config = ConfigDict(frozen=True)

    name: str
    title: str
    # 一句话简介。它同时是模型选技能时看到的那一句，所以要写得能区分
    summary: str
    surface_kinds: list[str]
    # 用这个技能需要的权限码。前端据它决定摆不摆入口
    required_codes: list[str] = Field(default_factory=list)


class ModelProfileOut(BaseModel):
    """能选的一路模型。"""

    model_config = ConfigDict(frozen=True)

    id: str
    label: str
    # 这一路此刻能不能用。⚠ 「装配得起来」不等于「能用」：订阅账号那一路
    # 还得先登录过，为假时前端把它灰着并指向系统页
    is_ready: bool
    has_vision: bool
    models: list[str] = Field(default_factory=list[str])
    # 可调的推理档位；空表示这一路没有这一档
    efforts: list[str] = Field(default_factory=list[str])


class CapabilityOut(BaseModel):
    """助手能力。

    ⚠ 前端把「取不到这份」当作「助手不存在」而不是「暂时故障」：某些现场
    根本不部署本服务，那时边缘直接 502，入口就该干净地不出现。
    """

    model_config = ConfigDict(frozen=True)

    # 模型端点是否配好并开着。关着时会话仍可读，但发不出新回合
    is_model_enabled: bool
    # 视觉输入是否可用。看截图提布局建议这类技能据它决定摆不摆
    is_vision_enabled: bool
    skills: list[SkillOut]
    # 这套部署接了哪几路模型。空 = 一路都没接
    models: list[ModelProfileOut] = Field(default_factory=list[ModelProfileOut])
    # 没选过时用哪一路。⚠ 必须是此刻**真能用**的那一路：订阅配了但没登录过时
    # 这里给的是按量那一路，否则助手开箱就是一个点了报错的下拉
    default_model_id: str = ""
    # 没选过时用哪一档推理。只有订阅那一路吃这一格，别的路忽略它
    default_effort: str = "medium"
