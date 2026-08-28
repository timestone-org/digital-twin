# AI 助手 V3 规划：绑点这件事从「能做」到「做得准、看得见」

第一期（[AI_ASSISTANT_DESIGN](AI_ASSISTANT_DESIGN.md)）立了三条支柱，第二期
（[AI_ASSISTANT_V2_PLAN](AI_ASSISTANT_V2_PLAN.md)）把它变成会立计划、会自查的 agent。
本期只干一件事：**把「让助手把一屏点位接上」这条路修到能真用**。

议题：[#129](https://github.com/timestone-org/digital-twin/issues/129)。

三条支柱一个字都不动：工具按「谁攥着那份状态」分两侧、POST+SSE 客户端驱动、技能渐进披露。

---

## 1. 六条要改的事，与各自的真因

| # | 用户看到的 | 真因 | 落点 |
|---|---|---|---|
| 1 | 助手绑完一屏点，画面上一个数都没变 | publisher 按**落库**的绑定组装推送计划（`publish_plan.py` 按 `row_version` 重读），草稿里的绑定它看不见 | 客户端工具 `dashboard.save` |
| 2 | 助手把「1 号机组温度」绑到了 2 号机组那一行 | `dashboard.read_bindings` 只回槽**声明**，不回每一行喂的是哪个实体；点位只有 `node_key` 没有名字 | 富化 read_bindings + 新增服务端 `points.resolve` |
| 3 | 2D 孪生里助手什么都干不了 | `Twin2dEditor` 根本没登记工作面 | 新工作面 `twin2d-editor` |
| 4 | 我选了三个模块说「把这几个接上」，它去改了别的 | 快照只有 `selected_id` 单数一格，孪生的快照连选中都没有 | 快照带多选 + 三个工作面统一 |
| 5 | 它不知道 gauge-card 该配什么 | 模块清单只有名字、类别、关键词，**没有一句说明** | `ModuleManifest.description` 贯穿到服务端目录 |
| 6 | 默认烧的是按量计费 | `ModelRegistry.default_id()` 取 `profiles()[0]`，而按量那一路排在前 | 默认改订阅 + 中等档 |

另有一条用户点名要的能力：**照抄绑定**（1 号机组接好了，2 号机组照着接）。

---

## 2. 工具契约（本期唯一真源，两侧逐字对齐）

新增或改形状的工具都列在这里。**服务端 `tool_specs.py` 与前端各工作面的 `tools`
数组必须与本节逐字相同**——对不上时模型看得见那个工具、调用却每次都失败。

### 2.1 `dashboard.save`（客户端，新增）

把当前草稿落库。大屏编辑器保存整屏；两个孪生子编辑器保存回宿主大屏节点。

- 参数：无。
- 返回：`{ ok: true, saved_version: number|null, note: string }`。
- ⚠ **失败一律抛**，尤其是 409：保存冲突意味着别人动过这张屏，静默吞掉会让模型
  接着绑下去，而每一条都存不进去。
- ⚠ 描述里必须写清「保存之后实时推送才认得新绑的点位」——这是模型主动调它的唯一理由。
- ⚠ 它保存的是**整份草稿**，包括用户自己刚改还没保存的那些。工具描述要挑明，
  技能正文要求模型在第一次保存前跟用户说一句。

### 2.2 `dashboard.read_values`（客户端，新增）

读此刻画面上的实时读数——**与画布渲染同一个取数源**（`usePointSamples` 那一份），
不另发请求。另发一次的话会出现「助手说有值、画面上是占位符」。

- 参数：`node_id`（可选；不给则整屏/整段孪生）。
- 返回：`{ items: [{ field_key, entity, node_key, source_kind, value, at, status }], unbound_count }`。
  `status` 取 `has_value` / `waiting`（订上了还没来第一帧）/ `unavailable` / `unbound`。
- ⚠ `waiting` 与 `unavailable` **必须分开**：合成一档的话，「刚保存还没到下一拍」
  会被模型读成「这个点位是坏的」，然后它去把绑定改掉。

### 2.3 `dashboard.copy_bindings`（客户端，新增）

把一处已经接好的整套绑定照抄到另一处。

- 参数（两组，只给一组）：
  - 大屏画布节点之间：`from_node_id`、`to_node_id`
  - 同一段孪生内的实体之间：`from_entity_id`、`to_entity_id`
  - 公共：`match`（`by_label` 缺省 / `by_index`）、`dry_run`（缺省 false）
- 返回：`{ copied: [{ from_field_key, to_field_key, node_key, source_kind, matched_by }],
  skipped: [{ from_field_key, reason }], is_dry_run }`。
- ⚠ **抄的是取数来源，不是配置**：单位、标题、阈值归 `set_config`。两件事混在一个
  工具里，用户说「照 1 号机组接一下」时会连标题一起变成「1 号机组…」。
- ⚠ `by_label` 匹配不上的行**列进 `skipped` 而不是退回按行号硬抄**：行号对齐是这套
  数组绑定最容易「每条都有值、全接错对象」的地方。
- ⚠ 目标处已有的绑定被覆盖时要在 `copied` 里标出来，模型据此跟用户交代。

### 2.4 `dashboard.read_bindings`（客户端，富化）

原来只回槽声明与已绑列表。现在每个数组槽要摊出**行**：

```
{
  node_id, module_type, node_label,            // node_label：画布上那个名字
  slots: [{ key, label, data_type, is_array, is_entity_pinned, is_required,
            row_count,                          // 来自 manifest.bindingRowCounts
            rows: [{ index, field_key, entity, entity_id,   // 来自 bindingRowLabels
                     source_kind, node_key, static_value }] }],
  scalars: [{ key, label, source_kind, node_key, static_value }],
  is_truncated
}
```

- ⚠ `entity` 是**这一行喂谁**的人话名字（孪生是「信息板名 · 字段名」，实时数值卡是
  指标名）。缺了它，模型只能按行号猜。
- ⚠ 行没绑时也要出现在 `rows` 里，`node_key: null`。省掉空行的话，模型会以为
  那些实体不存在。

### 2.5 `dashboard.read_canvas` / 快照（富化）

三个工作面统一多出这几格：

```
selected_id: string | null      // 保留，单选时仍给
selected_ids: string[]          // 新：选中全集，0/1/N
selected: Brief[]               // 新：由单个对象改成数组
```

- ⚠ 后端 `surface_context.render` 要**同时认数组与旧的单个对象**：会话是跨版本的，
  改成只认数组会让老前端发来的快照连选中项都读不出来。
- 孪生两个工作面的 `Brief` 是实体：`{ kind: 'panel'|'anchor'|'part'|'node'|'edge'|'mark',
  id, name }`。

### 2.6 `points.resolve`（服务端，新增）

批量把 `node_key` 换成人话。

- 参数：`node_keys: string[]`（上限 50）。
- 返回：`{ points: [{ node_key, name, code, unit, data_type, source_name }],
  unknown: string[] }`。
- ⚠ 认不出的进 `unknown` 而不是给一条空记录：空记录会被模型读成「这个点位存在、
  只是没名字」，于是它不再怀疑绑错了。

### 2.7 工作面 `twin2d-editor`（新增）

`ASSISTANT_SURFACE_KINDS` 前后端各加一项。2D 孪生工作面实现：
`dashboard.read_canvas` / `read_bindings` / `write_binding` / `remove_binding` /
`copy_bindings` / `read_values` / `save`。

- ⚠ **不给 `dashboard.capture`**：2D 舞台是 SVG/DOM，截图那条链路只在大屏与
  3D 替身上验过，没验过的工具摆出来就是每次调都失败。

---

## 3. 模块描述（第 5 条）

`ModuleManifest` 新增 `description: string`，经 `catalog.ts` 序列化进
`module_types.json`，`ModuleTypeOut` 收下，`module_catalog.brief_of` 放进名片。

一条合格的描述要回答四问，控制在 3–6 句：

1. **这是什么**：一句话，用现场的说法而不是组件名。
2. **什么时候用它、什么时候别用**：与最容易混淆的那个模块划清界限
   （info-card ↔ metric-card ↔ gauge-card 三者必须互相点名）。
3. **数据槽怎么喂**：几个槽、数组槽的行跟谁走、要什么数据类型与单位。
4. **踩过的坑**：删中间一项会让其后每行改喂前一项；容器模块的子节点归运行时；
   钉位模块每屏一个……只写这个模块**真有**的那条，没有就不写。

⚠ 描述是**给模型读的**，不是界面文案。写「用于展示实时数值」这种正确的废话等于没写；
要写「一块摆 1..N 个读数，行与 `items` 配置项一一对应，第 i 行喂第 i 个指标」。

⚠ 描述进 `module_types.json` 会让那份产物变长。它是生成物、不计评审规模
（`check_pr_policy.GENERATED` 不含它，但 `MODULES_SRC` 有单模块豁免，见闸门脚本）。

---

## 4. 默认模型（第 6 条）

- `ModelRegistry.default_id()`：订阅那一路在册就选它，否则退按量。
- 能力端点 `CapabilityOut` 新增 `default_effort: str`（取 `settings.codex_reasoning_effort`，
  缺省 `medium`）。
- ⚠ **「配了」不等于「能用」**：订阅那一路没登录过时（`is_ready=false`）默认要退回
  按量。把默认钉在一个点了就报错的选项上，等于整套助手开箱即坏。
- 前端 `probeInto` 拿 `default_model_id` 之外还要拿 `default_effort` 填进 `choice.effort`。

---

## 5. 分工与交付

一个分支 `feat/ai-binding-ux`，按服务切 PR（仓规矩：一个 PR 只碰一个服务）：

| PR | 范围 | 主要文件 |
|---|---|---|
| A | 模块描述贯通 | `web/packages/contracts`、`web/packages/modules`、`platform-server` 的目录 schema 与产物 |
| B | ai-assistant 后端 | `tool_specs` / `server_tools` / `surface_context` / `registry` / 技能正文 |
| C | 大屏编辑器工作面 | `web/app/src/features/ai/*`、`pages/DashboardEditor/scripts/aiSurface*` |
| D | 两个孪生工作面 | `pages/TwinEditor`、`pages/Twin2dEditor` |

⚠ 顺序：A 与 B 可并行；C 立起共享层之后 D 才动（两者共用绑定行富化与保存工具那两个
helper）。合并顺序 A → B → C → D，因为后一个的用例要引前一个的类型。
