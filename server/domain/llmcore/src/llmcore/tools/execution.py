"""本回合工具的参数校验、技能范围与可恢复失败提示。"""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from typing import Any, Protocol, cast

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from referencing import Registry

from lib.errors import AppError
from llmcore.output.tool_text import format_tool_output
from llmcore.skills import SkillManifest
from llmcore.skills.access import (
    load_skill,
    resource_answer,
    selected_skill,
)
from llmcore.tools.ports import ServerToolRunner, UnknownTool
from llmcore.tools.shapes import ToolSpec

MAX_ARGUMENT_ISSUES = 5


class ToolExecutionError(RuntimeError):
    """可直接供模型判断恢复方式的失败信息。"""


class SchemaValidator(Protocol):
    def iter_errors(self, instance: object) -> Iterator[ValidationError]: ...


def failure(
    code: str, message: str, next_action: str, *, execution: str = "not_started"
) -> ToolExecutionError:
    return ToolExecutionError(
        json.dumps(
            {
                "ok": False,
                "code": code,
                "message": message,
                "execution": execution,
                "retryable": False,
                "next_action": next_action,
            },
            ensure_ascii=False,
        )
    )


ToolDescriber = Callable[[tuple[ToolSpec, ...], str], dict[str, object]]


def describe_tool(specs: tuple[ToolSpec, ...], name: str) -> dict[str, object]:
    spec = next((one for one in specs if one.name == name), None)
    if spec is None:
        raise ValueError("本轮没有这个工具，请从当前清单选择")
    return {
        "name": name,
        "description": spec.description,
        "input_schema": spec.parameters,
        "runs_on": spec.runs_on,
        "is_exclusive": spec.is_exclusive,
    }


@dataclass(frozen=True)
class ToolExecutor:
    specs: tuple[ToolSpec, ...]
    skills: tuple[SkillManifest, ...]
    run_tool: ServerToolRunner
    describe: ToolDescriber = describe_tool
    max_skill_chars: int = 0
    result_reserve_chars: int = 0

    async def run_with_budget(
        self, name: str, arguments: dict[str, Any], max_chars: int
    ) -> Any:
        """元数据按完整 JSON 预算返回，避免正文和分页字段二次截断。"""
        if name not in {
            "skills.load",
            "skills.read_resource",
            "tools.describe",
        }:
            result = await self(name, arguments)
            if self.result_reserve_chars <= 0:
                return result
            return format_tool_output(
                result, max(1, max_chars - self.result_reserve_chars)
            )
        available = max(1, max_chars - self.result_reserve_chars)
        limit = min(self.max_skill_chars or available, available)
        result = await replace(self, max_skill_chars=limit)(name, arguments)
        text = json.dumps(result, ensure_ascii=False)
        if len(text) > limit:
            raise failure(
                "context_budget_exceeded",
                "完整工具说明超过本次上下文预算",
                "本轮未加载完整指令；缩短技能入口或增加模型上下文预算后再读取。",
            )
        return text

    async def __call__(self, name: str, arguments: dict[str, Any]) -> Any:
        spec = next((one for one in self.specs if one.name == name), None)
        if spec is None:
            raise failure(
                "tool_unavailable",
                "本轮未提供这个工具或权限不足",
                "从本轮工具清单选择可用工具。",
            )
        validate_arguments(spec, arguments)
        if name in {"skills.load", "skills.read_resource", "tools.describe"}:
            return await self._metadata(name, arguments)
        try:
            return await self.run_tool(name, arguments)
        except ToolExecutionError:
            raise
        except UnknownTool as error:
            raise failure(
                "invalid_arguments",
                str(error)[:600],
                "核对参数与本部署能力；用 tools.describe 查看完整输入定义。",
            ) from error
        except AppError as error:
            raise failure(
                "dependency_or_business_error",
                error.message[:600],
                "按提示核对权限、对象身份或依赖状态；写入结果未知时先读回核验。",
                execution="unknown",
            ) from error
        except Exception as error:
            raise failure(
                "tool_failed",
                f"{name} 调用失败（{type(error).__name__}）",
                "先读回核验目标状态；写操作结果未知时不要重复执行。"
                "只读请求可在依赖恢复后重新发起。",
                execution="unknown",
            ) from error

    async def _metadata(self, name: str, arguments: dict[str, Any]) -> object:
        try:
            if name == "skills.load":
                result = load_skill(
                    selected_skill(self.skills, arguments.get("name"))
                )
                if (
                    self.max_skill_chars
                    and len(json.dumps(result, ensure_ascii=False))
                    > self.max_skill_chars
                ):
                    raise failure(
                        "context_budget_exceeded",
                        "技能入口超过本轮上下文预算",
                        "本轮未加载完整指令；把专项说明拆到 references，"
                        "或增加上下文预算后重新加载。",
                    )
                return result
            if name == "skills.read_resource":
                return await resource_answer(
                    self.skills,
                    arguments,
                    max_output_chars=self.max_skill_chars or 12000,
                )
            return self.describe(self.specs, str(arguments["name"]))
        except ValueError as error:
            raise failure(
                "invalid_arguments",
                str(error)[:600],
                "按提示修正参数；需要完整输入说明时调用 tools.describe。",
            ) from error
        except OSError as error:
            raise failure(
                "skill_resource_unavailable",
                "技能资源暂时无法读取",
                "检查本地技能文件是否仍存在且可读，修复后再读取。",
            ) from error


def validate_arguments(spec: ToolSpec, arguments: dict[str, Any]) -> None:
    """按公布的 Schema 校验，不回显参数值。Args: spec, arguments。"""
    try:
        issues = _argument_issues(spec, arguments)
    except Exception as error:
        raise failure(
            "invalid_tool_schema",
            "工具输入定义无效或引用不可解析",
            "请维护者修复工具 Schema；不访问外部引用，不要反复更换业务参数。",
        ) from error
    if issues:
        raise failure(
            "invalid_arguments",
            "; ".join(issues),
            "工具尚未执行；修正字段后重新调用，"
            "或用 tools.describe 查询完整输入定义。",
        )


def _argument_issues(spec: ToolSpec, arguments: dict[str, Any]) -> list[str]:
    validator = cast(
        SchemaValidator,
        Draft202012Validator(spec.parameters, registry=Registry()),
    )
    issues: list[str] = []
    for error in validator.iter_errors(arguments):
        path = ".".join(str(part) for part in error.absolute_path) or "$"
        rule = str(error.validator)
        expected = json.dumps(error.validator_value, ensure_ascii=False)
        issues.append(f"{path}: {rule}={expected[:300]}")
        if len(issues) == MAX_ARGUMENT_ISSUES:
            break
    return issues
