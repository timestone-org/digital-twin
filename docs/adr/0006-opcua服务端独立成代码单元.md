---
status: accepted
date: 2026-08-12
---

# ADR-0006：OPC UA 服务端独立成代码单元

`opcua-server` 独立持有 `opcua` schema、非 HTTP 的 `opc.tcp` 端口池和进程内地址空间。它与作为 OPC UA 客户端的 collector 方向、数据和运行时均不同；端口独占与本地状态也不适合放进可水平扩展的 platform API 角色。

该服务固定单副本，不做租约热备：备副本无法预先绑定同一端口，切换仍会重建地址空间并要求上位机重连。代价是重启窗口内整体不可用，部署必须保证端口池映射一致并要求客户端重连；细节见 [opcua-server 上下文](../../server/services/opcua-server/CONTEXT.md)。
