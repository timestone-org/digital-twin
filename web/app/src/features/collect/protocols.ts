/**
 * @fileoverview 采集协议的人话标签：挑点位时要说清一个数据源跑的是哪种协议。
 *
 * ⚠ 认不出的协议原样显示，绝不隐藏：后端接进第二种驱动而这里还没跟上时，
 * 「显示成空白」会被读成「这个数据源没配协议」。
 * ⚠ 接新协议时只有两处要改：`@dt/contracts` 的 `COLLECT_PROTOCOLS` 加一项、
 * 这份文案加一句。挑点位这条路上再没有别处认协议——点位身份
 * `{source_id}:{point_code}` 与它背后跑的是哪种协议无关（ADR-0011）。
 */

import { COLLECT_PROTOCOLS } from '@dt/contracts'
import type { CollectProtocol } from '@dt/contracts'

const PROTOCOL_LABELS: Record<CollectProtocol, string> = {
  opcua: 'OPC UA',
}

/**
 * 协议的人话标签；不认识的取值原样回。
 * @param protocol 后端给的协议取值
 */
export function protocolLabel(protocol: string): string {
  const known = COLLECT_PROTOCOLS.find((one) => one === protocol)
  return known === undefined ? protocol : PROTOCOL_LABELS[known]
}
