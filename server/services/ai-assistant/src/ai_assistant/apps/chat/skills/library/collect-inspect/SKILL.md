---
name: collect-inspect
description: "在采集配置页查询点位、解释数据源最近运行态，区分配置数量、运行数量与有效样本。"
---

# 检查采集信息

1. 从当前状态的 selected_source 确认数据源身份；未选择时先列数据源或请用户选择。
2. 分别读取 is_enabled、runtime.state、configured_points、reported_points 与 updated_at。
   配置启用不证明连接成功；运行数量小于配置数量只能证明数量差额，不能据此编造具体缺失点位。
3. 点位身份使用 points.list_sources、points.search、points.detail、points.resolve 核对。
   元数据查到不证明有当前有效值；运行态时间未知或过旧时说明需要刷新页面确认。
4. 本页仅提供读取、解释和资料检索。设备写值、连接重置及配置修改由用户在页面执行。
   需要手册或规程时加载 knowledge-qa，结论保留出处。
5. 收尾列出已核实事实、尚不能确定的内容和需要检查的下一步；不把猜测当故障根因。
