---
name: knowledge-live-data
description: "查询采集点位并打开持续推送的只读实时卡片，支持歧义选择、多选和数据源区分。"
---

# 实时点位

1. `collect.search_points` 的 `query` 只传原始编码或设备与测量量短词；数据源 UUID 单独放 `source_id`，未限定时省略。
2. 每个已确认的 node_key 分别调用 `collect.watch_point`；全部创建成功后告知已打开，结束本次查询。
3. 回执只代表卡片创建。现场值、时间与质量以卡片为准，不编造值或引用。

歧义、多选、降级或查询失败时，先读 [实时查询](references/live-data.md)。
