---
status: accepted
date: 2026-09-02
---

# ADR-0038：语音输入经 knowledge-server 中继到自建 FunASR

知识库语音输入使用现场自建 FunASR，浏览器音频经 `knowledge-server` 中继。浏览器直连会暴露内网服务且在 HTTPS 页面触发混合内容限制；放进 realtime-hub 又会破坏其订阅扇出边界。

WebSocket 凭据仍由边缘转换并完成现有鉴权，knowledge 只读签名身份头；服务到 FunASR 的连接有明确超时、不自动重试、也不进入 readiness。协议帧、整段转写与尾静音等实现口径由 speech 模块维护。页面即使按 ADR-0051 允许 HTTP 嵌入，浏览器麦克风仍受“HTTPS 或 localhost”安全上下文限制。
