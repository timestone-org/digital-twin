---
status: accepted
date: 2026-09-22
---

# ADR-0056：PLC 直连首版采用只读 Modbus TCP

PLC 直连的首个驱动采用 `modbus_tcp`，只开放 coils、discrete inputs、holding
registers 与 input registers 的读取，不开放任何写功能、网络扫描、站号枚举或厂商
私有指令。数据离开驱动后仍是 `(point_code, value, ts_ms, quality)`，继续走现有
Redis 快照、归档 Stream、TimescaleDB 与实时 WebSocket 链路。

每个数据源保持一条独立异步会话，因此多台 PLC 并发且故障隔离；同一 PLC 连接
一次最多一个在途请求。驱动只合并相邻或重叠且已配置的地址，不跨空洞扩大读取
范围，并受 Modbus 与设备配置的单请求上限约束。协议库禁用内部重试，重连仍只由
`SourceSession` 负责，避免重试相乘。采集进程还设默认关闭的 PLC 开关与精确目标
允许清单，未经现场授权的地址不会建连；源周期至少 1 秒，点位实际周期取其自身
配置与源周期的较大值。读失败写 `bad` 质量，丢主时先撤销全部会话继续发请求的权利。

寻址串使用显式零基偏移 `area:offset:value_kind`，不接受容易与 40001 等厂商引用
号混淆的隐式写法。首版支持位值、16/32 位有符号或无符号整数、32/64 位浮点，
字节序与字序由数据源选项明确配置。字符串、数组、缩放公式、串口 Modbus RTU、
Siemens S7、EtherNet/IP 与 Mitsubishi 私有协议不在本次范围。

选用 `pymodbus` 的异步客户端而不自行实现 Modbus 报文栈：协议异常、取消、连接
生命周期和设备差异具有隐藏复杂度；依赖固定到已验证版本，且 import 只允许位于
`drivers/modbus_tcp/`。只读仍会占用 PLC 通信资源，现场启用前必须由设备负责人
确认目标、地址表、周期与请求上限，并从低负载逐步放量。
