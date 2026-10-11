---
name: twin-configure
description: "按名称与文件夹自行定位多个三维孪生目标，修改模型、部件、锚点、视点、信息牌、箭头、能量流和漫游配置，并诊断与截图核验。"
---

# 配置三维孪生

修改当前三维孪生草稿里的模型、部件与场景实体。每次修改都进入页面现有撤销栈，
但仍是**未保存草稿**。

## 工作顺序

1. 明确目标范围：“这个部件”按 `selected` 定位；按名称、编号或类别描述的目标
   按 [目标解析](references/target-resolution.md) 查找，不受当前选中项限制。
2. 按名称、编号查找或未限定文件夹时，直接用 `twin.list_entities`；用户限定文件夹时
   先用 `twin.list_folders` 查，再将同一 `section` 的 `folder_id` 原样交给实体列表。
   单例用 `twin.read_config`，实体详情用 `twin.read_entity`。
3. 用 `twin.patch_config` 只给要改的字段。它会深合并对象、整段替换数组，并返回
   归一化后的真实配置；范围外数字可能被夹取，非法值可能回落缺省，以回执为准。
4. 每批修改后调用 `twin.diagnose`。修完阻断配置含义的问题再结束。
5. 外观、位置、显隐或场景效果变化必须用 `dashboard.capture` 看一眼；不满意就继续修。
6. 配置修改告知草稿尚未保存，用户明确要求时才调用 `dashboard.save`；
   实时绑定按 `dashboard-binding` 的保存与读数核验流程执行。

## 按需参考

按名称、编号、文件夹描述多个目标时，先用 `skills.read_resource` 读取 [target-resolution.md](references/target-resolution.md)。

## 按需参考

读取实体详情、修改部件字段、数组或模型素材前，先用 `skills.read_resource` 读取 [entity-contracts.md](references/entity-contracts.md)。
