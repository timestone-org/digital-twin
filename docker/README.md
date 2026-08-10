# 部署编排

## edge-gateway

唯一的入口。它做**且只做**：TLS 终结、按前缀反向代理、`auth_request` 前置鉴权、
公开面限流、前端静态资源发布。任何需要读库才能回答的问题都不属于边缘。

`nginx/nginx.conf.template` 是 envsubst 模板，由官方镜像在启动时渲染。

> ⚠ 必须设 `NGINX_ENVSUBST_FILTER=^AUTH_`，否则 `$uri` / `$host` 这些 nginx 变量
> 会被 envsubst 一起替换成空串，表现为「路由全乱、鉴权全过」。

### 三处不能改的配置

1. **server 级把 6 个 `X-Auth-*` 头置空**。客户端伪造这些头就等于伪造身份；
   只在 `auth_request` 成功后由 `auth_request_set` 重新注入。
2. **免认证 location 只有那几条**。规则表里的空 `permission_codes` 语义是
   「任意已登录用户放行」而**不是**匿名放行——匿名可达性只由这些 location 保证。
   删掉 `/sessions` 那条就会全站无法登录，且管理员自己也进不去。
3. **`/internal/` 一律 deny**。`/verify` 与权限回查都挂在那下面，
   它们只认服务级密钥，对外暴露等于把鉴权端点交给公网。

### 缓冲区

`/verify` 的响应头里带 base64 编码的权限集，默认 4k 的 `proxy_buffer_size`
会截断它。配置里显式设了 8k。

## compose

```bash
cd docker
cp ../.env.example .env   # 填数据库、Redis 与三个密钥
docker compose up -d --build
```

共享值（`AUTH_EDGE_SERVICE_KEY` 等）的回退链**必须每个服务都写全**：
少写一处就是非对称失效——发送端有值、接收端没有，一律 403，
而现象与原因隔得极远。
