# DigitalTwin Web

前端是 Vue 3 + TypeScript 的 pnpm workspace。开发、检查与构建命令见
[`CONTEXT.md`](CONTEXT.md#8-本地命令)。

## 嵌入业务页面

在任意受支持的原页面 URL 上增加 `token` 与 `theme`，即可作为 iframe 首航：

```html
<iframe
  src="https://twin.example.com/dashboards/019...?token=dtk_xxx_xxx&theme=emerald"
  title="数字孪生页面"
  width="1440"
  height="900"
></iframe>
```

`theme` 必须是以下六个 id 之一：

- `dark-tech`
- `light`
- `nebula-violet`
- `emerald`
- `lava-amber`
- `cobalt-deep`

首航会先把 API Key 复制进当前文档内存并启动短期会话交换，随即从地址栏
移除 `token`、保留 `theme`，并增加非敏感的 `embed=1` 标记。清理后的导航会
等待交换完成，拿到短期 access token 与用户权限后才显示业务页。API Key、
短期令牌和用户信息都只保存在当前页面内，不写 localStorage。

因此，**不要把交换后的干净 URL 当成可刷新链接**：刷新后页面只剩 `embed=1`，会明确
提示嵌入凭据已经丢失。宿主应重新设置 iframe 的原始 `src`，让它用仍有效的 API Key
重新首航。嵌入态的站内跳转会自动携带 `embed=1`，不会回落到同源浏览器的普通账号。

嵌入页隐藏平台全局左侧导航和主题切换器，但保留页面自己的业务侧栏。页面权限与
API Key 所属用户完全一致；无权访问时显示嵌入错误，不进入普通 403/登录流程。

以下页面不接受嵌入：

- `/profile`
- `/system/**`
- `/login`
- `/public/:publicToken`
- 403 与 404 错误页

初始 URL 短暂包含长期 API Key，只应交给受信任的宿主页面。密钥必须设置明确
到期日（永不过期的密钥会被换票端点拒绝），并按既有轮换与吊销机制管理。
生产环境必须使用 HTTPS/WSS；页面入口声明了 `no-referrer`，不会把这段初始 URL
作为 Referer 带给后续请求。
