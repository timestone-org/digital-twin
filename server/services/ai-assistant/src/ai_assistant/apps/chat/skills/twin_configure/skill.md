# 配置三维孪生

修改当前三维孪生草稿里的模型、部件与场景实体。每次修改都进入页面现有撤销栈，
但仍是**未保存草稿**。

## 工作顺序

1. 明确目标范围：“这个部件”按 `selected` 定位；按名称、编号或类别描述的目标
   按下方“自行解析多个目标”查找，不受当前选中项限制。
2. 类别先用 `twin.list_folders` 查，再将同一 `section` 的 `folder_id` 原样交给
   `twin.list_entities`；单例用 `twin.read_config`，实体详情用 `twin.read_entity`。
3. 用 `twin.patch_config` 只给要改的字段。它会深合并对象、整段替换数组，并返回
   归一化后的真实配置；范围外数字可能被夹取，非法值可能回落缺省，以回执为准。
4. 每批修改后调用 `twin.diagnose`。修完阻断配置含义的问题再结束。
5. 外观、位置、显隐或场景效果变化必须用 `dashboard.capture` 看一眼；不满意就继续修。
6. 配置修改告知草稿尚未保存，用户明确要求时才调用 `dashboard.save`；
   实时绑定按 `dashboard-binding` 的保存与读数核验流程执行。

## 自行解析多个目标

界面只支持单选；`selected` / `selected_ids` 数组只用于兼容快照，不代表可多选。
用户给出名称、设备编号、位置或文件夹范围时，你自行读取名片确定目标，不要求用户
在大纲或视口多选，也不要求逐个点击部件。

1. 从描述提取实体类型和范围。例如“1号机组所有水泵”先查 `section=parts`，
   用“水泵”这样的短关键词查名片，再结合部件名中的机组编号和文件夹判定。
   `keyword` 是字面包含筛选，不是语义搜索；全句未命中时拆词、换同义词，
   或去掉关键词分页浏览相关类别，不能把一次未命中解释成没有目标。
2. 用户提到文件夹或区域分类时先用 `twin.list_folders` 查真实身份；未限定文件夹
   时跨文件夹查实体。多个名称分别检索，并按 `section + id` 去重。
   单个目标找到即可停；“所有”“全部”“这类”必须把相关范围翻至 `has_more=false`。
3. 综合名称、编号、位置、文件夹判断；如“1号”不能误纳“10号”，同名但不同区域
   不自动合并。只有读过名片与必要详情仍无法确定范围时，才用 `user.ask` 列出
   有歧义的具体候选，让用户在聊天里确认，不让用户去画布多选。
4. 范围明确后简短说明识别到的类别和数量，直接继续已授权操作，不额外要求确认
   普通草稿修改。先收集完整目标 ID，再逐个读 `twin.read_entity` 和调用修改工具；
   改名、改分类时也沿用这份 ID 名单，避免边翻页边修改筛选字段造成漏项。
5. 只处理用户描述覆盖的目标。危险操作仍按常驻规则确认；多目标用 `plan.write`
   跟踪进度，按回执报告成功、失败和未处理数量，未遍历完不能宣称“全部完成”。

“这些水泵”这类带明确类别的说法按名称解析；只有“这几个”且没有名称、类别、
文件夹或前文已确定名单时才询问范围。界面当前选中一个无关部件不影响按名称批量处理。

## 读取与修改

读取职责不能混用：

- `twin.list_folders` 按页返回六类实体的文件夹目录。回执带
  `schema_version`，每项是 `{section,folder_id,name,item_count}`；文件夹身份是
  `section + folder_id`，不是一段可凭名字构造的文本。
- `twin.list_entities` 的 `section` 只可取 `parts`、`anchors`、`cameras`、
  `panels`、`arrows`、`flows`。需要筛选时，`folder_id` 只能逐字复制
  `twin.list_folders` 中同一 `section` 的结果；不能填文件夹名字、实体 id、素材 id
  或 `asset:<uuid>`。名片的 `id` 可直接传给详情与修改工具，所属目录为
  `{section,folder_id,name}` 或 `null`；先筛选再分页，每页最多 20 条。
  文件夹目录可按 `section`、`keyword` 筛选；实体可按 `folder_id`、`keyword` 筛选。
  保持筛选和 `limit` 不变，用 `next_page` 继续；按上方目标范围决定何时结束。
- `twin.read_entity` 必须同时给实体 `section` 与名片上的 `id`，返回完整 `config`
  和同一套文件夹身份；`twin.read_config` 只读 `model`、`viewpoints`、`roam` 三个单例。

如果本轮工具清单缺少上述三个实体读取工具，说明浏览器仍是旧页面能力。此时不得猜
`folder_id`，也不得假装已经按类别读取；请用户刷新页面后再继续。新工具名就是这项
能力的版本协商信号。

- `model`：素材、缩放、位置、旋转、背景、自动旋转、动画与场景特效。
- `parts`：名字、从属、关联模型节点、外观、显隐、状态染色、点击和详情卡片。
- `anchors` / `cameras`：空间位置、视点与可见性。
- `panels`：信息牌位置、字段、样式与锚定。
- `arrows` / `flows`：方向标记与锚点之间的能量流。
- `viewpoints` / `roamTour`：视点切换控件与自动漫游。

修改 `model.asset` 前调用 `assets.search(kind="model")`，确认结果 `kind=model` 后只
复制 `ref`（`asset:<uuid>`）；裸 id、文件夹 id 与 URL 都不是合法素材引用。压缩档
单独写进 `model.variant`，不能拼进引用串。

`patch` 只写读回配置里真实存在的键，不能改 `id`。嵌套对象可以只给一个叶子，
例如 `{"look":{"opacity":0.45}}` 不会冲掉已有颜色；数组是完整替换，例如改
`nodes`、`detail.fields`、`tint.stops` 时必须把要保留的项全部带回。

## 部件的易错口径

- 大纲文件夹只是分类，不是装配关系；部件的装配层级看 `parentId`。文件夹不改变
  实体文档序，也不改变数组绑定的行号，不能按文件夹里的显示顺序猜绑定行。
- `look.color=''` 表示保留模型原材质；`opacity`、`blend` 范围 0–1，`glow` 范围 0–3。
- `tint=null` 表示不取数；启用染色后还要配置规则并用绑定工具绑定对应行。
- `visibility.visible` 是初始可见；距离规则必须同时带 `ref` 与 `value`。
- `click.far='view'` 时要有取景快照或 `cameraId`，并配置 `clickDistance.farThreshold`。
- 要显示详情，`click.near` 设为 `detail`，且 `detail.fields` 不能空。详情字段另走
  `partFieldValues` 绑定，不能拿状态染色的绑定代替。
- `parentId` 指向另一个部件；自指、成环或不存在的 id 都会由诊断报告。
