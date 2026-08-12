# opcua-server

对上位系统（SCADA、MES）暴露 `opc.tcp` 端点的发布面，单进程内托管多个 OPC UA 服务器实例。HTTP 管理面前缀 `/api/v1/opcua`，端口 8008；实例的 `opc.tcp` 端口从固定端口池分配，**不经 edge-gateway**。

设计与不变量见 [`CONTEXT.md`](CONTEXT.md)；独立成代码单元、单活不做租约、落地提交豁免规模闸的理由见 [ADR-0006](../../../docs/adr/0006-opcua服务端独立成代码单元.md)。

## 建设状态

本目录当前只有文档与依赖声明，**尚无 Python 代码**。骨架与业务面按 [issue #5](https://github.com/timestone-org/digital-twin/issues/5) 的交付序列分批落地。

## 结构（落地后）

```
src/opcua_server/
├── __main__.py      进程入口（可执行名 opcua-server）
├── app.py           装配 FastAPI（中间件与异常映射由 lib.web.create_app 单点给）
├── container.py     组合根：配置 → 各协作对象
├── settings.py      继承 lib 的配置基类，只加本服务字段（端口池、PKI 目录）
└── apps/instance/
    ├── errors.py    领域异常（错误码领域号 21）
    ├── api/         路由；只取参 → 调 service → 包封
    ├── services/    实例生命周期、地址空间、值读写、会话追踪
    ├── crud/        数据访问，不提交
    ├── models/      ORM，绑定 opcua schema
    └── schemas/     对外模型
migrations/          本服务独占的迁移链，绑定 opcua schema
tests/{unit,integration,contract,e2e}
```

## 依赖

`asyncua` **钉死在 1.1.8**，不用范围约束——会话追踪要子类化 `InternalServer` 与
`InternalSession`，这两个扩展点不在文档化的公开 API 里（理由见 `CONTEXT.md` §5）。
它是 LGPLv3+，评估结论记在 [`scripts/gates/licenses-reviewed.json`](../../../scripts/gates/licenses-reviewed.json)。

## 配置

| 变量 | 说明 |
|---|---|
| `OPCUA_PORT_POOL` | 实例可用的 `opc.tcp` 端口段，默认 `4840-4859`。**部署期常量**，必须与容器端口映射一致 |
| `OPCUA_PKI_DIR` | 服务器证书与私钥的挂载卷。私钥只在这里，不进库、不进镜像层 |
| `OPCUA_MAX_INSTANCES` | 单进程实例数上限 |

完整清单随骨架落地补齐。
