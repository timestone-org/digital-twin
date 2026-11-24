# 阜阳空压站大屏与推荐发布

大屏沿用同一项目「光伏 · 智慧运维」的主题、页头、页脚、卡片与图表排版。使用现有信息卡片、趋势曲线、对比柱图、页头、页脚、文本块和数字时钟。机组按 1# 定频、2# 至 4# 变频排列，分别显示已核验读数与 OPC UA 推荐值。顶部将母管需气量与已计量供气分开显示。全站气电比口径包含四台主机和两路冷却辅机，缺少完整计量时留空。

## 点位与历史

KEPServer 的 `DL.KY` 提供空压站压力、部分实际转速和冷却读数，`DL.PD` 提供主辅机有功功率。按真实 NodeId 读取并确认类型和质量后，在采集页面复用已有点位或新增点位，启用归档。输出使用 `juanbaochucheng` 实例中已有的 `RECOMMEND_KYJ1` 至 `RECOMMEND_KYJ4`，读侧单独通过 OPC UA 数据源采集这四个节点。

已核验并归档 2#、3# 的 `KY_CO2_KYJ2_FT_LJ` 与 `KY_CO2_KYJ3_FT_LJ`。分钟台账采每分钟最后的累计读数，相邻分钟做差。采样断档、读数下降和回零时对应差值留空。累计表倍率默认按 m³，需用表计确认。变更倍率时同时更新分钟台账公式及 worker 标定参数。1# 累计量、母管需气量留空待核验，4# 暂只接入已确认的功率、排气压力与推荐状态。历史文件中的瞬时流量不应作为累计读数导入。

历史样本用采集服务的 [`scripts/import_history.py`](../server/services/collector-server/scripts/import_history.py) 追加。CSV 使用 UTF-8，表头为 `point_code,ts,value_num`，每行一个数值点位，时刻明确带时区。阜阳历史文件的北京时间按 `Asia/Shanghai` 转为 UTC。导入程序先核对采集计划和整个文件，再逐批按归档主键幂等追加。相同时刻原有样本优先。此入口归采集服务所有，平台对 `collect` schema 继续只读。

```shell
python scripts/import_history.py /path/to/verified-history.csv --source-id <数据源UUID>
python scripts/import_history.py /path/to/verified-history.csv --source-id <数据源UUID> --apply
```

## 图表及校准

[分钟台账配置](../examples/fuyang-compressed-air/dataset.json) 使用现有点位汇总和公式列。`COUNT_OVER` 验证相邻分钟有累计读数，`PREV` 求差，再与同一分钟的平均功率计算气电比。历史转速档按排气压力范围选择样本，最近三天有至少五个样本时，用该档的总气量除以总用电量显示气电比。机组卡片上的当前读数用于和对应转速档对照。

[大屏组态](../examples/fuyang-compressed-air/dashboard.json) 的 24 小时功率趋势直接读点位归档。分钟产气、气电比与转速双轴趋势、分档对比柱图消费台账列。历史查阅窗口通过现有组态面板配置。实时压力、功率、转速和四个推荐状态经原有大屏 WebSocket。

worker 按配置的时间窗从正式归档定期拟合，默认 120 天，每 15 分钟刷新一次。每台机组按 UTC 分钟配对，筛掉缺测、低负荷、压力不合格和变化过快的样本，按速度档取流量、功率中位数，并要求最少样本和至少三个不同自然日。前端图表使用所选窗口进行描述性复核，worker 使用自己的稳态筛选和校准范围。两侧均不保存分析报告中的静态读数或固定组合表。导入新样本或继续采集后，能在相应刷新点看到更新。

## OPC UA 推荐

在 `platform-worker` 通过 `PLATFORM_COMPRESSED_AIR` 配置 JSON。配置包含 `demand_node_key`、`opcua_instance_id`、按 1# 至 4# 排列的 `recommendation_node_ids`，以及四台 `machines`。每项含 `volume`、`power`、`pressure` 三个点位的 `node_key`，变频机再含 `speed`。计量倍率与前端保持一致，使用 `volume_scale`。暂不参加推荐的机组在 `machines` 对应位置填 `null`。可选 `available_node_keys` 按机号配置布尔可用状态。`calibration_days`、`minimum_samples_per_band` 和 `calibration_pressure_min/max` 可以覆盖标定默认值。留空不启动推荐循环。

程序枚举可用机组组合，在归档支持的流量范围内满足指定需气量并最小化估计主机功率。辅机实测用于大屏系统气电比。尚未做分组合辅机实测修正时，组合排序使用同一辅助负载假设。缺少需气量、可用机组未完成标定、或需求落在范围之外时不生成开机建议。四个目标必须均为已存在、可写的布尔节点。有效组合按机号写入 `True` 或 `False`，无建议时全为 `False`。批量回执逐项核对。该输出供上位机读取建议，启停和保护仍由现场控制系统负责。

后台依赖已有采集快照、在线运行态、只读归档和 OPC UA 内部批量写接口。worker 持独立 Redis 租约，不依赖打开大屏。发生写超时只记录结果未确认，下一拍计算新建议。四个 bool 本身无法表达写入时间或通讯异常，上位机若要使用其当前有效性，需要另行结合通讯质量和业务有效性判断。
