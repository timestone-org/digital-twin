/** Local synthetic EMS fixture based on the 2026-10-27 hour/minute contract. */
const http = require('node:http');
const intervals = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];
const prefix = '/bdm/training-data';

function send(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: status, message: status === 200 ? 'ok' : 'Synthetic upstream failure', data }));
}
function page(items, query) {
  const number = Number(query.get('page') || 1);
  const size = Number(query.get('pageSize') || 50);
  return { total: items.length, page: number, pageSize: size, items: items.slice((number - 1) * size, number * size) };
}
function stamp(ms) {
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
function instant(text) { return Date.parse(text.replace(' ', 'T') + '+08:00'); }
function formula(body, res) {
  const code = body.codes?.[0];
  if (code === 'DEMO_HTTP_ERROR') return send(res, null, 503);
  const minutes = body.granularity === 'hour' ? 60 : body.intervalMinutes ?? 1;
  const start = instant(body.startDate);
  const end = instant(body.endDate);
  if (!['hour', 'minute'].includes(body.granularity) || !intervals.includes(minutes) || !(start < end) || (start % (minutes * 60000)) || (end % (minutes * 60000)) || (body.granularity === 'hour' && body.intervalMinutes !== 60)) return send(res, null, 400);
  const samples = [];
  for (let value = start; value < end; value += minutes * 60000) {
    samples.push({ ct: stamp(value), ...(samples.length === 1 ? {} : { value: samples.length + 10 }) });
  }
  const metadata = code === 'DEMO_LEGACY' ? {} : { intervalMinutes: minutes, endExclusive: true };
  return send(res, { ...metadata, series: [{ code, name: '模拟分时能耗', samples }] });
}
function history(body, kind, res) {
  const key = kind === 'point' ? 'pointId' : 'propertyId';
  const id = (kind === 'point' ? body.pointIds : body.propertyIds)?.[0];
  const start = instant(body.startTime);
  const end = instant(body.endTime);
  if (!id || !(start < end) || body.sort !== 'desc') return send(res, null, 400);
  const count = Math.min(1001, Math.ceil((end - start) / 60000));
  const offset = body.offset ?? 0;
  const limit = body.limit;
  const length = Math.max(0, Math.min(limit, count - offset));
  const samples = Array.from({ length }, (_, i) => ({ ct: stamp(end - (offset + i + 1) * 60000), value: offset + i }));
  return send(res, { kind, series: [{ [key]: id, name: '模拟历史样本', samples, ...(offset ? { offset } : {}), ...(offset + length < count ? { nextOffset: offset + length } : {}) }] });
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  const query = url.searchParams;
  if (url.pathname === `${prefix}/points/systems`) return send(res, { items: ['示例供冷系统', '示例空压系统'], systemFilterAvailable: true });
  if (url.pathname === `${prefix}/points`) {
    const items = Array.from({ length: 75 }, (_, i) => ({ pointId: `demo-point-${i + 1}`, code: `DEMO.T${i + 1}`, name: `示例冷机 ${i + 1} 号温度`, system: '示例供冷系统', tableType: 'Tech', historyAvailable: true }));
    const filtered = items.filter(item => (!query.get('name') || item.name.includes(query.get('name'))) && (!query.get('code') || item.code === query.get('code')) && (!query.get('keyword') || `${item.name} ${item.code} ${item.tableType}`.includes(query.get('keyword'))) && (!query.get('system') || item.system === query.get('system')));
    return send(res, { ...page(filtered, query), systemFilterAvailable: true });
  }
  if (url.pathname === `${prefix}/catalog`) {
    const items = query.get('kind') === 'formula' ? [{ code: 'DEMO_ENERGY', name: '示例用电量' }] : [{ propertyId: 'demo-property-1', nodeId: 'demo-node', nodeName: '示例空压机', nodeSystem: '示例空压系统', propertyName: '有功功率', unit: 'kW', unitCategory: 3, dataType: 'number' }];
    return send(res, page(items.filter(item => (!query.get('name') || (item.name || item.propertyName).includes(query.get('name'))) && (!query.get('system') || item.nodeSystem === query.get('system'))), query));
  }
  if (url.pathname === `${prefix}/indicators`) {
    const items = [{ id: 'demo-indicator', code: 'demo.energy', name: '示例能耗强度', category: 'energy', status: 'active', sources: [{ sourceType: 'unitProperty', sourceId: 'demo-property-1', alias: '功率', unit: 'kW' }, { sourceType: 'modelOutput', sourceId: 'demo-prediction', alias: '预测输出' }] }];
    return send(res, page(items.filter(item => !query.get('code') || item.code === query.get('code')), query));
  }
  if (req.method === 'POST' && url.pathname === `${prefix}/formula/query`) return formula(req.body || {}, res);
  if (req.method === 'POST' && url.pathname === `${prefix}/points/query`) return history(req.body || {}, 'point', res);
  if (req.method === 'POST' && url.pathname === `${prefix}/raw/query`) return history(req.body || {}, 'raw', res);
  return send(res, null, 501);
}).listen(process.env.PORT);
