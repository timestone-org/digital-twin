## 照着另一处接一遍

「1 号机组接好了，2 号机组照着接」用 `dashboard.copy_bindings`，不要手抄。

1. 先 `dry_run: true` 跑一次，把 `copied` 与 `skipped` 拿给用户过目。
2. `copied` 里覆盖掉目标原有绑定的那几条要**点出来**。
3. `skipped` 里的**如实报**：按名字对不上就是对不上。
4. 用 `user.ask` 让他拍板（覆盖掉的那几条写进选项的 `hint` 里），
   确认后再 `dry_run: false` 落一次，然后照常 `dashboard.save` +
   `dashboard.read_values`。

⚠ **匹配不上不要改用 `by_index` 硬抄。** 按行号对齐是这套数组绑定最容易出
「每一条都有值、但全接错对象」的地方，而那种错在画面上完全看不出来。

⚠ 它抄的**只是取数来源**。标题、单位、阈值这些配置归 `dashboard.set_config`，
不要指望它一起过去——真一起过去了，2 号机组的标题会变成「1 号机组…」。


## 不接点位的那几种槽

不是每一格都来自现场。用户说「这一格就写 380」「额定值填死」时，
用 `dashboard.write_binding` 的 `source_kind: "static"` 加 `value`：

```
dashboard.write_binding(node_id=…, field_key="itemValues[2].value",
                        source_kind="static", value=380)
```

- `value` 可以是数字、文本、真假。
- ⚠ **不能给 `null`**：那一层把 null 读成「没配过」，画面上是「取不到」
  而不是空值，而你会以为自己配好了。
- 常量槽没有历史、也不推送，所以趋势图那类时序槽绑常量是没有意义的。

⚠ 常量与点位**是同一条绑定的两种取数方式**。要把一个已经绑了常量的槽改接
点位，直接再写一次 `write_binding`（换成 `opcua` 加 `node_key`）——
不要先 `remove_binding` 再绑：绑定 id 是实时推送的关联键，解了再绑会断一次。


## 数组槽位

多数数据模块的槽位是**数组槽**（一个槽对应 N 行），槽键形如 `itemValues[0].value`。

- 列表式槽行号**必须从 0 起、连续**；`is_entity_pinned=true` 的实体槽允许只绑其中几行，不能为了凑连续而替用户绑定其它实体。
- 有的数组槽是**钉在实体上**的（孪生的锚点、信息牌）：第 i 行喂配置里第 i 个实体，
  行数由配置决定。这种槽 `dashboard.read_bindings` 会给出每行对应的实体名字
  （`entity`），**按名字对，不要按行号猜**。
- 还没绑的行也会出现在 `rows` 里、`node_key` 为 null。那不是这一行不存在，
  是它还空着——正好是你要接的那些。


## 历史图表与台账来源（大屏编辑器）

趋势曲线和日历热力需要历史序列，不能给它们接实时点位或常量来冒充历史。
先用 `modules.catalog(module_type=…)` 查看子槽的 `is_time_series`，再用
`dashboard.read_bindings` 获取实际 field_key 和已有的 detail。在大屏编辑器用 `dashboard.read_config`
核对已配置的系列、指标和表格列名。不要猜子槽叫 value：
趋势和日历是 series，数据表格是 c1…c8。

- 点位归档：`source_kind="archive"`、`node_key`、`range`；根据用户含义选择
  `aggregate`（avg / max / min / sum / count）、`interval` 和 `timezone`。
- 数据台账：先 `datasets.list_tables` 获取表 code，再 `datasets.read_columns`
  核对列 key、类型与单位；身份是 `ds:<表code>:<列key>`，写入 `dataset_key`，
  同时给 `source_kind="dataset"` 与 `range`。不能编造表或列。
- `range` 必须给相对窗 `{"last_window":"7d"}` 或绝对窗
  `{"from_ms":…, "to_ms":…}`，只能给一组；时间均为 UTC 毫秒。
  当前时序渲染不支持 `limit`，通过时间窗和归档桶宽控制取数。
- 日历模块的显示时区与归档分桶时区应一致。逐日归并与采样聚合是两层计算：
  必须依据指标含义选择，不能仅凭单位断定累计表底应该求和。
- 时序绑定的草稿在画布中就会触发取数；纯历史配置不需要为看数主动保存。
  实时绑定仍遵守上文「绑—存—看」流程。
- `dashboard.read_values` 读取画布实际使用的序列，检查 `series.point_count`、
  `from` / `to`、`is_truncated`、`truncated_side`、`is_stale`。
  `empty` 表示请求成功但窗口内无点，不等于失败；`waiting` 稍后重读；
  `unavailable` 按 note 说明原因。截断、陈旧与尚未渲染都不能宣称已验收完成。
- 孪生子编辑器暂不支持写历史来源，应引导到相应绑定面板。
