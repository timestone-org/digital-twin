"""层 3 规划编排：单模型 + 计划工具的那套阈值（ADR-0024）。

⚠ 这一包对外只认这个再导出面。别的功能模块直接伸进子模块时结构闸**不会拦**
（它只判跨功能 import 路径的第 4 段是不是 `services`），只能靠这份清单与评审守。
"""

from ai_assistant.apps.chat.services.planning.ports import PlanPolicy

__all__ = ["PlanPolicy"]
