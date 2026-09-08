---
status: accepted
date: 2026-08-12
---

# ADR-0008：opcua-server 以变异测试补偿分支覆盖例外

`asyncua` 初始化生成的大型标准地址空间与 coverage 分支追踪组合会使真实握手测试挂死，因此 `opcua-server` 只采集行覆盖，并且必须同时使用 `branch = false` 与 `COVERAGE_CORE=sysmon`。真实服务器测试不能为追求指标而移出覆盖范围。

nightly 对运行时层执行变异测试作为补偿控制；移除它之前必须先恢复可用的分支覆盖。若 coverage 或 asyncua 升级后分支追踪能在秒级完成，应撤销本例外并抬高分支基线。
