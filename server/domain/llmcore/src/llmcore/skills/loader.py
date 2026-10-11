"""读取标准技能包与元数据；限制文件大小并拒绝越界资源。"""

from pathlib import Path

import yaml

from llmcore.skills.manifest import (
    SkillInstructionsMissing,
    SkillManifest,
)
from llmcore.skills.schemas import (
    SkillIntegration,
    SkillMetadata,
)

MAX_SKILL_BYTES = 96_000
MAX_SKILL_CHARS = 16_000
MAX_RESOURCE_BYTES = 256_000
MAX_RESOURCE_FILES = 256


def read_text(path: Path, limit: int) -> str:
    """有界读取 UTF-8 文件。Args: path, limit。"""
    with path.open("rb") as stream:
        body = stream.read(limit + 1)
    if len(body) > limit:
        raise ValueError(f"技能文件超过 {limit} 字节：{path.name}")
    return body.decode("utf-8-sig")


def read_skill(
    directory: Path, integration: SkillIntegration | None
) -> SkillManifest:
    """读取一个技能的元数据与正文。Args: directory, integration。"""
    path = directory / "SKILL.md"
    if (
        "SKILL.md" not in {entry.name for entry in directory.iterdir()}
        or not path.is_file()
        or not path.resolve().is_relative_to(directory.resolve())
    ):
        raise SkillInstructionsMissing(
            f"{directory.name} 缺少本目录的 SKILL.md"
        )
    lines = read_text(path, MAX_SKILL_BYTES).splitlines()
    if not lines or lines[0] != "---":
        raise ValueError(f"{directory.name}/SKILL.md 缺少 YAML frontmatter")
    try:
        end = lines.index("---", 1)
        raw: object = yaml.safe_load("\n".join(lines[1:end]))
        meta = SkillMetadata.model_validate(raw)
    except (ValueError, yaml.YAMLError) as error:
        raise ValueError(f"{directory.name}/SKILL.md 的元数据无效") from error
    body = "\n".join(lines[end + 1 :]).strip()
    if not body or not meta.description.strip():
        raise SkillInstructionsMissing(f"{directory.name} 的描述或正文为空")
    if len(body) > MAX_SKILL_CHARS:
        raise ValueError(
            f"{directory.name} 正文过长，请将专项说明移到 references/"
        )
    if meta.name != directory.name:
        raise ValueError(f"技能名 {meta.name} 必须与目录 {directory.name} 一致")
    return SkillManifest(
        name=meta.name,
        title=integration.title if integration else meta.name,
        summary=meta.description.strip(),
        surface_kinds=tuple(integration.surface_kinds) if integration else (),
        required_codes=tuple(integration.required_codes) if integration else (),
        server_tools=tuple(integration.server_tools) if integration else (),
        client_tools=tuple(integration.client_tools) if integration else (),
        directory=directory.resolve(),
        body=body,
        compatibility=meta.compatibility,
        resources=resource_names(directory.resolve()),
    )


def resource_names(directory: Path) -> tuple[str, ...]:
    """列出有界资源索引，保持确定顺序。Args: directory。"""
    names: list[str] = []
    for parent, folders, files in directory.walk():
        folders[:] = [name for name in folders if _is_resource_name(name)]
        for name in files:
            if name == "SKILL.md" or not _is_resource_name(name):
                continue
            path = parent / name
            if path.is_symlink():
                raise ValueError(f"技能资源不支持符号链接：{directory.name}")
            if path.is_file():
                names.append(path.relative_to(directory).as_posix())
            if len(names) > MAX_RESOURCE_FILES:
                raise ValueError(
                    f"{directory.name} 的技能资源超过 {MAX_RESOURCE_FILES} 个"
                )
    return tuple(sorted(names))


def _is_resource_name(name: str) -> bool:
    return not (
        name.startswith(".")
        or name.endswith(".pyc")
        or name in {"__pycache__", "node_modules"}
    )


def read_resource(skill: SkillManifest, relative: str) -> str:
    """读取技能内声明的文本资源。Args: skill, relative。"""
    if relative not in skill.resources:
        raise ValueError(
            "资源不存在，请使用 skills.load 返回的 resources 相对路径"
        )
    target = (skill.directory / relative).resolve()
    if not target.is_relative_to(skill.directory) or not target.is_file():
        raise ValueError("资源路径必须位于当前技能目录内")
    return read_text(target, MAX_RESOURCE_BYTES)
