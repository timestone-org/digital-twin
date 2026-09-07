# 配置三维孪生

修改当前三维孪生草稿里的模型、部件与场景实体。每次修改都进入页面现有撤销栈，
但仍是**未保存草稿**。

## 工作顺序

1. 从工作面快照确认用户当前选中了什么。用户说“这个部件”时只认 `selected`。
2. 用 `twin.read_config` 读取目标节；修改实体时必须带真实 id，不按数组下标猜。
3. 用 `twin.patch_config` 只给要改的字段。它会深合并对象、整段替换数组，并返回
   归一化后的真实配置；范围外数字可能被夹取，非法值可能回落缺省，以回执为准。
4. 每批修改后调用 `twin.diagnose`。修完阻断配置含义的问题再结束。
5. 外观、位置、显隐或场景效果变化必须用 `dashboard.capture` 看一眼；不满意就继续修。
6. 告诉用户草稿尚未保存。只有用户明确要求保存时才调用 `dashboard.save`。

## 读取与修改

`section` 可取 `model`、`viewpoints`、`roam`、`parts`、`anchors`、`cameras`、
`panels`、`arrows`、`flows`。数组节不给 id 时返回 `folders` 目录和名片；目录项是
`{id,name,item_count}`，每张名片的 `folder` 是 `{id,name}`，`null` 表示未分类。
问题涉及“某一类”时，先从目录确认稳定的文件夹 id，再带 `folder_id` 读取该类；
筛选发生在 100 条上限之前。要改实体之前再带 id 读取完整项，所属 `folder` 会与
`config` 分开返回，不能把它写进 patch。

- `model`：素材、缩放、位置、旋转、背景、自动旋转、动画与场景特效。
- `parts`：名字、从属、关联模型节点、外观、显隐、状态染色、点击和详情卡片。
- `anchors` / `cameras`：空间位置、视点与可见性。
- `panels`：信息牌位置、字段、样式与锚定。
- `arrows` / `flows`：方向标记与锚点之间的能量流。
- `viewpoints` / `roamTour`：视点切换控件与自动漫游。

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
