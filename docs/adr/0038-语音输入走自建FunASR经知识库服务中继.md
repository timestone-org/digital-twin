# ADR 0038：语音输入走自建 FunASR，经 knowledge-server 中继

- 状态：已接受
- 日期：2026-09-02

## 背景

知识库对话页要能**用嘴问**：按一下麦克风、说一句、转写进输入框。两个硬约束：

1. **现场不能上外网。** 浏览器自带的 Web Speech API 把音频送到厂商云端识别，
   在现场根本不可用；用户已自建了 FunASR（`funasr_wss_server.py`，
   `websockets 16`，`ws://<内网地址>:10095`，**明文 ws**）。
2. **浏览器开麦只在安全上下文里开放。** `getUserMedia` 在 `http://` 页面上根本
   不存在（`localhost` 除外）——这是浏览器的规矩，任何后端设计都绕不过去。

对 FunASR 协议实测出三条硬事实（组长用本机 TTS 合成中文对着真服务跑过）：

- 握手必须报子协议 **`binary`**，否则 400「missing subprotocol」；
- 连上先发一条 init JSON（`mode: 2pass` / `wav_format: pcm` / `audio_fs: 16000`
  …），之后二进制帧是 16 kHz 单声道 int16 小端 PCM，结束发 `is_speaking: false`；
- **收口前不补足够长的尾部静音，服务端不给终稿，连最后一个字都丢。** FunASR
  靠 VAD 判「说完了」，本部署实测 1.5 s 不够、3 s 够；太短的表现不是报错，
  是每一句都要等到超时才拿到不带标点的在线整段。

`2pass` 模式先逐块给 `2pass-online` **增量**（要拼接），最后给 `2pass-offline`
整句修正、`is_final: true`。

## 决策

**一、浏览器不直连 FunASR，音频经 `knowledge-server` 中继。** 三条路：

| | 浏览器直连 FunASR | 放 realtime-hub | 放 knowledge-server（本决策） |
|---|---|---|---|
| 鉴权 | 没有：FunASR 不认人 | hub 自验 token | 边缘 `auth_request` 注入签名头 |
| 内网暴露 | 整个 FunASR 端口对外 | 无 | 无 |
| 明文 ws | HTTPS 页面会拦混合内容 | 服务端到服务端，不受限 | 同左 |
| 能力开关 | 无处放 | hub 的形态由 ADR-0007 钉死为订阅扇出 | `/capabilities` 顺手报 `is_asr_enabled` |

直连有三个问题各自都够否决；hub 是订阅扇出的形态，塞一条「点对点音频中继」
进去等于给它第二种形态。知识库对话是这个功能唯一的消费方，中继放在它旁边，
配置、能力探测、权限码都只有一处。

**二、鉴权在边缘做，服务侧一行 JWT 代码都没有。** `knowledge-server` 的原则是
「不自己校验令牌，只读边缘注入的签名身份头」（`deps.py`）。浏览器的
`WebSocket` 构造器放不了 `Authorization` 头，token 只能走子协议
（`["dt.auth", <token>]`，与 realtime 那条同一形状）。边缘加一条 `map` 把
`Sec-WebSocket-Protocol` 里的 token 映射成 `Authorization: Bearer …`，交给
`/_auth_ws`（与 `/_auth` 逐行相同、只多这一个头）去问 auth-server 的
`/verify`，再把 X-Auth-* 签名头注进去。服务端读的仍是那组头。

⚠ 这与 realtime-hub 的做法**刻意不同**：hub 免认证、自己验 token，是因为它的
订阅授权要按主题另判（ADR-0007）；这里只有一个码、一条端点，边缘映射一下就够，
不值得让第二个服务长出 JWT 校验。

**三、消息契约的唯一真源在后端 `apps/speech/services/protocol.py`。** 前端复述
一份，由契约用例按路径读后端源码逐字比对（同 `knowledge-chat.contract.spec.ts`）。
服务端回的 `text` 永远是**整段**（已定稿各句 + 当前句的在线增量），客户端整体
替换、不自己拼——让客户端拼的话，一帧丢了或重了，两侧文本就永远对不上。

**四、中继不重试，也不进就绪探针。** 一条链路只有一层负责重试，这条链上那一层
是用户再按一次麦克风。FunASR 是外部依赖，抖一下不该让整组副本被摘；接没接由
`/capabilities` 如实回答，连不连得上由每次握手如实回答（关闭码 1013）。

**五、权限码复用 `knowledge:use`，不新造 `knowledge:speech`。** 能问就能用嘴问；
两者之间不存在任何一种「能 A 不能 B」的真实诉求。

## 后果

- **浏览器开麦仍要 HTTPS 或 localhost。** 这与本设计无关，是浏览器的安全上下文
  要求：`http://` 页面上麦克风键会报「只在 HTTPS 或 localhost 页面上开放麦克风」。
  现场部署**必须给边缘配 TLS**；FunASR 那一段是服务端到服务端的明文 ws，不受此限。
- 边缘多了一条 `map`、一条 `/_auth_ws`、一条精确匹配的 WS location；两份 nginx
  （容器模板与 Windows 版）都要同步。
- `knowledge-server` 显式依赖 `websockets`（客户端那条腿），不再靠
  `uvicorn[standard]` 顺手装进来的那份。
- 一句话最长 60 s、浏览器 30 s 不送帧当离开、stop 之后等终稿 5 s——三道时限是
  配置项，缺省按现场一句提问的长度定。收口前补的尾部静音也是配置项
  （`KNOWLEDGE_ASR_TAIL_SILENCE_S`，缺省 3 s）：VAD 的尾部判定随 FunASR 的
  配置而异，换一套部署要能只改这一格。

## 部署步骤

1. **配 env**：`KNOWLEDGE_ASR_ENABLED=true`、`KNOWLEDGE_ASR_URL=ws://<FunASR>:10095`
   （可选 `KNOWLEDGE_ASR_HOTWORDS`）。开关开着却没给地址 = 启动即失败。
2. **重跑 auth 种子**：闸 1 多了一条 `GET /api/v1/knowledge/speech/ws` 的规则，
   compose 的 `auth-migrate` 作业会跑 `python -m scripts.seed`；不跑的话新端点
   一律 403，而表现是「能力面说接了语音、一开麦就 403」。
3. **边缘 reload**：容器版重建 edge-gateway；Windows 版把模板里新增的三段同步进
   `dt-edge.windows.conf` 后 `nginx -s reload`。
4. 边缘要有 TLS（见「后果」第一条）。
