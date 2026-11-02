/** OpenAI 兼容调用面的本地合成模型，格式来源于仓库适配器测试；不证明真实供应商能力。 */
const http = require("node:http");
const stateKey = "assistant-model.validation";

async function state() {
  const stored = await pm.state.get(stateKey);
  if (stored) return stored;
  return { mode: "normal", records: [], chat: 0, summary: 0 };
}
async function save(value) {
  await pm.state.set(stateKey, value);
}
function send(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}
function chunk(response, value) {
  response.write("data: " + JSON.stringify(value) + "\n\n");
}
function message(text, call) {
  const answer = { role: "assistant", content: text };
  if (call) answer.tool_calls = [call];
  return answer;
}
function completion(model, text, call) {
  return {
    id: "chatcmpl-local-validation",
    object: "chat.completion",
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: message(text, call),
        finish_reason: call ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 1500, completion_tokens: 20, total_tokens: 1520 },
  };
}
http
  .createServer(async (request, response) => {
    const path = new URL(request.url, "http://fixture").pathname;
    if (request.method === "POST" && path === "/control") {
      const mode = (request.body || {}).mode || "normal";
      await save({ mode, records: [], chat: 0, summary: 0 });
      return send(response, 200, { mode });
    }
    const current = await state();
    if (request.method === "GET" && path === "/stats")
      return send(response, 200, current);
    if (request.method !== "POST" || path !== "/v1/chat/completions") {
      return send(response, 501, { error: { code: "not_modeled" } });
    }
    const body = request.body || {};
    if (!Array.isArray(body.messages) || typeof body.model !== "string") {
      return send(response, 400, { error: { code: "invalid_request_error" } });
    }
    const isSummary = body.model === "context-summary";
    if (isSummary) current.summary += 1;
    else current.chat += 1;
    const overflow =
      !isSummary && current.mode === "overflow-once" && current.chat === 1;
    current.records.push({
      kind: isSummary ? "summary" : "chat",
      stream: body.stream === true,
      message_count: body.messages.length,
      input_chars: JSON.stringify(body.messages).length,
      tool_count: Array.isArray(body.tools) ? body.tools.length : 0,
      status: overflow ? 400 : 200,
    });
    await save(current);
    if (overflow) {
      return send(response, 400, {
        error: {
          type: "invalid_request_error",
          code: "context_length_exceeded",
          message: "Synthetic context overflow",
        },
      });
    }
    const text = isSummary
      ? "用户要求保留 T001 温度点位，旧结论仍适用。"
      : "已完成真实传输边界验收。";
    const call =
      !isSummary && current.mode === "client-tool" && current.chat === 1
        ? {
            id: "wire-call-1",
            type: "function",
            function: {
              name: "dashboard.write_binding",
              arguments: JSON.stringify({
                node_id: "n1",
                field_key: "value",
                node_key: "T001",
              }),
            },
          }
        : null;
    if (!body.stream)
      return send(response, 200, completion(body.model, text, call));
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const envelope = {
      id: "chatcmpl-local-validation",
      object: "chat.completion.chunk",
      created: 1,
      model: body.model,
    };
    chunk(response, {
      ...envelope,
      choices: [
        { index: 0, delta: { role: "assistant" }, finish_reason: null },
      ],
    });
    if (call) {
      chunk(response, {
        ...envelope,
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, ...call }] },
            finish_reason: null,
          },
        ],
      });
    } else {
      chunk(response, {
        ...envelope,
        choices: [
          {
            index: 0,
            delta: { content: text.slice(0, 5) },
            finish_reason: null,
          },
        ],
      });
      chunk(response, {
        ...envelope,
        choices: [
          { index: 0, delta: { content: text.slice(5) }, finish_reason: null },
        ],
      });
    }
    chunk(response, {
      ...envelope,
      choices: [
        { index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" },
      ],
    });
    chunk(response, {
      ...envelope,
      choices: [],
      usage: { prompt_tokens: 1500, completion_tokens: 20, total_tokens: 1520 },
    });
    response.end("data: [DONE]\n\n");
  })
  .listen(process.env.PORT);
