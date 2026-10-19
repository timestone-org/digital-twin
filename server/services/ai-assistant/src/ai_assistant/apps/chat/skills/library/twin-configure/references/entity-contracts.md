## 读取与修改

读取职责不能混用：

- `twin.list_folders` 按页返回六类实体的文件夹目录。回执带
  `schema_version`，每项是 `{section,folder_id,name,item_count}`；文件夹身份是
  `section + folder_id`，不是一段可凭名字构造的文本。
- `twin.list_entities` 的 `section` 只可取 `parts`、`anchors`、`cameras`、
  `panels`、`arrows`、`flows`。省略 `folder_id`、传空字符串或 `null` 均表示不限定
  文件夹，包含根目录与各文件夹中的实体；例如按名称查根目录里的空压机，直接调用
  `{"section":"parts","keyword":"空压机"}`。空文件夹列表也继续这样查实体。
  非空 `folder_id` 只能逐字复制 `twin.list_folders` 中同一 `section` 的结果；
  根目录实体沿用未限定查询，不构造 `root` 或 `__unfiled__` 之类的目录 id。
  名片的 `id` 可直接传给详情与修改工具，所属目录为
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
- 直接点击切视角用 `click.near='view'`；需要远近分档时，再配置
  `clickDistance.farThreshold` 和 `click.far`。
- 切视角必须明确 `click.viewSource`：预设视点用 `camera` 并设置 `cameraId`；
  取景快照用 `snapshot` 并设置 `view`。修改来源时保留另一份取景配置，
  读取实际配置后再写入，不能假设快照始终覆盖预设视点。
- 要显示详情，`click.near` 设为 `detail`，且 `detail.fields` 不能空。详情字段另走
  `partFieldValues` 绑定，不能拿状态染色的绑定代替。
- `parentId` 指向另一个部件；自指、成环或不存在的 id 都会由诊断报告。
