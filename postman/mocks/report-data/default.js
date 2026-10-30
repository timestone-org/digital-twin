/** 报告按需取数的本地合成接口；不代表任何第三方供应商契约。 */
const http = require('node:http');
const counts = Object.create(null);

function send(response, data, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
}

http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (request.method === 'GET' && url.pathname === '/stats') {
    return send(response, { counts });
  }
  if (request.method !== 'POST' || url.pathname !== '/query') {
    return send(response, { error: 'Synthetic endpoint not modeled' }, 501);
  }
  const scenario = url.searchParams.get('case') || 'good';
  counts[scenario] = (counts[scenario] || 0) + 1;
  const body = request.body || {};
  if (request.headers['x-api-key'] !== 'local-report-fixture-only') {
    return send(response, { error: 'Synthetic authentication rejected' }, 401);
  }
  if (body.period !== '2026-10' || body.start !== '2026-09-30T16:00:00.000Z' ||
      body.end !== '2026-10-31T16:00:00.000Z' || body.zone !== 'Asia/Shanghai') {
    return send(response, { error: 'Report period variables did not match' }, 400);
  }
  if (scenario === '503') {
    return send(response, { secret: 'Synthetic upstream details must stay private' }, 503);
  }
  if (scenario === 'missing') return send(response, { data: [{ ts: body.start }] });
  if (scenario === 'outside') {
    return send(response, { data: [{ ts: body.end, value: '1', label: '越界' }] });
  }
  if (scenario === 'large') return send(response, { data: 'x'.repeat(2_000_001) });
  if (scenario !== 'good') return send(response, { error: 'Scenario not modeled' }, 501);
  return send(response, { data: [
    { ts: '2026-10-01T00:00:00Z', value: '9007199254740993.125', label: '精确数值' },
    { ts: '2026-10-02T00:00:00Z', value: 0, label: '真实零值' },
    { ts: '2026-10-03T00:00:00Z', value: null, label: '缺测' },
  ] });
}).listen(process.env.PORT);
