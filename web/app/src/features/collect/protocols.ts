/**
 * @fileoverview 采集协议的人话标签：挑点位时要说清一个数据源跑的是哪种协议。
 *
 * ⚠ 认不出的协议原样显示，绝不隐藏：后端接进第二种驱动而这里还没跟上时，
 * 「显示成空白」会被读成「这个数据源没配协议」。
 * ⚠ 协议清单与文案保持一致；点位身份
 * `{source_id}:{point_code}` 与它背后跑的是哪种协议无关（ADR-0011）。
 */

import { COLLECT_READABLE_PROTOCOLS } from '@dt/contracts'
import type { CollectProtocol, CollectReadableProtocol } from '@dt/contracts'

const PROTOCOL_LABELS: Record<CollectReadableProtocol, string> = {
  http: 'HTTP / HTTPS',
  modbus_tcp: 'Modbus TCP',
  opcua: 'OPC UA',
}

export const COLLECT_PROTOCOL_PAGES: Record<
  CollectProtocol,
  { path: string; title: string; subtitle: string; selectionHint: string }
> = {
  opcua: {
    path: '/collect/opcua',
    title: 'OPC UA 采集',
    subtitle: '管理 OPC UA 数据源、浏览地址空间并订阅或轮询采集点位',
    selectionHint:
      '从左侧选择 OPC UA 数据源，查看连接状态、浏览地址空间并管理点位。',
  },
  modbus_tcp: {
    path: '/collect/modbus-tcp',
    title: 'Modbus TCP 采集',
    subtitle: '管理 PLC 连接与寄存器点位，通过只读轮询采集数据',
    selectionHint:
      '从左侧选择 Modbus TCP 数据源，查看连接状态并配置只读寄存器点位。',
  },
  http: {
    path: '/collect/http',
    title: 'HTTP / HTTPS 采集',
    subtitle: '管理接口请求与认证，从同一份 JSON 响应映射多个采集点位',
    selectionHint:
      '从左侧选择 HTTP / HTTPS 数据源，查看连接状态并通过 JSON 样例配置点位。',
  },
}

/**
 * 协议的人话标签；不认识的取值原样回。
 * @param protocol 后端给的协议取值
 */
export function protocolLabel(protocol: string): string {
  const known = COLLECT_READABLE_PROTOCOLS.find((one) => one === protocol)
  return known === undefined ? protocol : PROTOCOL_LABELS[known]
}
