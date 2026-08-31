"""按调用者的权限码收窄技能集。

`SkillManifest.required_codes` 在五个技能上都声明了，而服务端从来没有校验过它
——`skills_for` 只按工作面过滤。它一直是个死信号。

⚠ **这不是权限边界，只是省一次往返。** 工具最终调 platform，由那边按端点判权限
（`CONTEXT.md` §2：助手绝不用服务级密钥去替用户读它本来读不到的数据）。这一道
拦掉的是「模型看见一个它这个账号用不了的技能，先试一次、被拒、再换路」。
**platform 那边的判权一步都不能省。**
"""

from dataclasses import dataclass

from ai_assistant.apps.chat.services.intent.ports import Allowed, TurnContext
from ai_assistant.apps.chat.skills import find_skill


@dataclass(frozen=True)
class PermissionGate:
    """留下调用者持得全码的那几个技能。"""

    @property
    def name(self) -> str:
        """这一道收窄在注册表里的名字。"""
        return "permission"

    def narrow(self, context: TurnContext, allowed: Allowed) -> Allowed:
        """收窄一次。

        ⚠ 调用方没给权限信息（`codes is None`）时**原样放行**：与 `client_tools`
        为 `None` 时退回技能声明推导同一口径——宁可多见几个，也不许把能用的
        藏掉。真要收紧的是调用点该把码传进来，不是这里默认最严。

        Args: context, allowed。
        """
        held = context.codes
        if held is None:
            return allowed
        return allowed.keep_skills(
            frozenset(name for name in allowed.skills if _is_held(name, held))
        )


def _is_held(skill_name: str, held: frozenset[str]) -> bool:
    """这个技能要的码是不是都在手上。

    ⚠ 认不出的技能名**放行**：名字对不上多半是这一层与注册表漂开了，
    而那时把它藏掉只会让「助手忽然少了个技能」更难查。

    Args: skill_name, held。
    """
    skill = find_skill(skill_name)
    if skill is None:
        return True
    return frozenset(skill.required_codes) <= held
