# realtime-hub

维持 WebSocket 长连接、管理订阅关系、把其它服务推来的消息按订阅扇出给客户端。对外前缀 `/api/v1/realtime`，端口 8000。

它**不读任何业务表**：认识的是连接、用户、主题、载荷，不认识实例、点位或大屏。边界见 [ADR-0005](../../../docs/adr/0005-实时通道与边缘网关的职责分界.md)，形态见 [ADR-0007](../../../docs/adr/0007-实时通道薄化与开放主题命名空间.md)——**开放主题命名空间，订阅授权由推送方在登记主题时声明**。

设计与不变量见 [`CONTEXT.md`](CONTEXT.md)。

## 建设状态

本目录当前只有文档与依赖声明，**尚无 Python 代码**。骨架与业务面按 [issue #5](https://github.com/timestone-org/digital-twin/issues/5) 的交付序列分批落地（PR-5b）。第一个推送方是 `opcua-server`（PR-6）。

## 结构（落地后）

```
src/realtime_hub/
├── __main__.py      进程入口（可执行名 realtime-hub）
├── app.py           装配 FastAPI（中间件与异常映射由 lib.web.create_app 单点给）
├── container.py     组合根：配置 → 各协作对象
├── settings.py      继承 lib 的配置基类，只加本服务字段
└── apps/channel/
    ├── errors.py    领域异常（错误码领域号 20）
    ├── api/         客户端 WS 端点、内部登记与推送端点
    ├── services/    连接注册、订阅授权、扇出、seq 分配
    ├── crud/        数据访问，不提交
    ├── models/      ORM，绑定 realtime schema
    └── schemas/     对外模型（WS 消息信封见 api-contract §10）
migrations/          本服务独占的迁移链，绑定 realtime schema
tests/{unit,integration,contract,e2e}
```

## 依赖

只有 `lib[auth,db,redis,web]` 一档，没有第三方新增。**四个 extra 一个都不能省**，理由写在 `pyproject.toml` 里：开发用的是 workspace 共享 venv，漏声明在本地与全部用例里都发现不了，只有独立镜像会启动即崩。

`redis` 那一档是**跨副本扇出**用的：本服务按连接数水平扩，一条 HTTP 推送只落在一个副本上，而订阅连接分布在所有副本上（`CONTEXT.md` §4）。

## 配置

| 变量 | 说明 |
|---|---|
| `REALTIME_SERVICE_KEY` | 内部端点的服务级密钥。**不给默认值**，未配置即拒绝一切内部调用 |
| `REALTIME_AUTH_BASE_URL` | auth-server 地址，登记主题时校验声明的权限码 |
| `REALTIME_PERMISSION_TTL` | 权限上下文复核间隔，默认 60 秒 |

完整清单随骨架落地补齐。

## 两条最容易踩空的

- **WS 的 token 走子协议**，HTTP 头上的鉴权中间件对它不生效，闸 1 也认不出它。`/api/v1/realtime/ws` 在权限目录里是空码规则，匿名可达性由边缘免认证 location 保证，认证在本服务内部完成。
- **权限复核不满足时只退订相关主题**，不断整条连接——断整条会把用户正在看的其它无关主题一起牵连。
