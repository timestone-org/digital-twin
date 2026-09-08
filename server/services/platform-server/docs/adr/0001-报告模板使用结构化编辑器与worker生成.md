---
status: accepted
---

# ADR-0001：报告模板使用结构化编辑器并由 worker 生成

报告正文保留结构化业务节点，前端使用 Tiptap 与现有 `@dt/ui` 编辑，不嵌入另一套应用级编辑器；最终 Word 由 platform worker 使用 python-docx 和 DrawingML 生成，导入与生成均不占 API 进程。

编辑器不承诺模拟 Word 的全部分页，不能无损导入的内容必须明确列出。任务使用数据库快照与幂等身份，经队列交给 worker；数据关系与版式约束见 [报告设计](../../../../../docs/REPORT_TEMPLATE_DESIGN.md)。
