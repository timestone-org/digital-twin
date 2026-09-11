# DigitalTwin Web

前端是 Vue 3 + TypeScript 的 pnpm workspace。开发、检查与构建命令见
[`CONTEXT.md`](CONTEXT.md#8-本地命令)。

## 前端环境变量

将 `app/.env.example` 复制为 `app/.env.local`，按需修改：

```dotenv
VITE_KNOWLEDGE_CHAT_MAX_ACTIVE_LIVE_CARDS=20
```

此项控制知识库对话中最近自动订阅的实时卡片数量，未设置默认 20，只接受正整数。
逻辑与停止提示使用同一个值；非法配置会在开发服务器启动或构建时直接报错。
环境变量在构建时写入前端，修改后需运行 `pnpm --dir web build` 并刷新页面；开发时
重启 `pnpm --dir web dev`。只重启后端或修改 `docker/.env` 不会改变已构建的前端。

## 字体与授权

本软件使用并随包分发 HarmonyOS Sans SC，字体版权归 Huawei Device Co., Ltd.；
资源保持官方原件，授权全文与来源说明见
[`packages/tokens/src/fonts/`](packages/tokens/src/fonts/)，发布物同时保留
[`THIRD_PARTY_NOTICES.txt`](app/public/THIRD_PARTY_NOTICES.txt)。

大屏读数可选择随包提供的 DS-Digital。它是 shareware，正式商业交付前需按原始
授权完成商业注册；授权全文同时保留在
[`DS-Digital-LICENSE.txt`](app/public/DS-Digital-LICENSE.txt)。字体缺少的中文、
单位与符号会安全回退到默认字体。

## 嵌入业务页面

在任意受支持的原页面 URL 上增加 `token` 与 `theme`，即可作为 iframe 首航：

```html
<iframe
  src="http://twin.example.com/dashboards/019...?token=dtk_xxx_xxx&theme=emerald"
  title="数字孪生页面"
  width="1440"
  height="900"
></iframe>
```

`theme` 必须是以下七个 id 之一：

- `dark-tech`
- `light`
- `naive-green`
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

有限期与永久 API Key 都可以嵌入。HTTP/WS 与 HTTPS/WSS 均受支持，
实时通道会自动跟随页面协议。但初始 URL 短暂包含完整 API Key：HTTP 下它会
以明文经过网络，永久密钥泄漏后又不会自动到期。建议使用专用最小权限账号，
并确保可以随时吊销。页面入口声明了 `no-referrer`，但无法防止抓包、浏览器历史、
截图或父页脚本读取初始 URL。

HTTPS 宿主页通常会被浏览器禁止嵌入 HTTP iframe（mixed content）。这是浏览器
限制，不是本应用的协议门禁；这种组合下嵌入页仍需改用 HTTPS。
