"""标准技能 frontmatter 与本地页面映射的配置边界。"""

from pydantic import BaseModel, ConfigDict, Field


class SkillMetadata(BaseModel):
    """保留跨客户端扩展字段，核心元数据严格校验。"""

    model_config = ConfigDict(extra="ignore", strict=True)
    name: str = Field(
        min_length=1, max_length=64, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
    )
    description: str = Field(min_length=1, max_length=1024)
    compatibility: str = Field(default="", max_length=500)


class SkillIntegration(BaseModel):
    """部署方维护的业务工具集成，独立于可复制的技能包。"""

    model_config = ConfigDict(extra="forbid", strict=True)
    name: str
    title: str
    surface_kinds: list[str] = Field(default_factory=list[str])
    required_codes: list[str] = Field(default_factory=list[str])
    server_tools: list[str] = Field(default_factory=list[str])
    client_tools: list[str] = Field(default_factory=list[str])


class SkillRoute(BaseModel):
    """多个页面路径可映射同一组技能。"""

    model_config = ConfigDict(extra="forbid", strict=True)
    paths: list[str] = Field(min_length=1, max_length=100)
    skills: list[str] = Field(min_length=1, max_length=100)


class SkillRoutes(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    routes: list[SkillRoute] = Field(
        default_factory=list[SkillRoute], max_length=200
    )
