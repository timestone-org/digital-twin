/**
 * @fileoverview 采集点位的只读面，给绑点面板挑点用。
 * ⚠ 这一组打的是 platform-server，每个函数都要给 `baseUrl`。
 * ⚠ 这里的「点位」是采集侧的 point，不是画布上的 node——两个 node 不是一回事
 * （docs/DASHBOARD_DESIGN.md §1）。
 */
import type { Page } from '@dt/contracts'

import { PLATFORM_BASE_URL } from '@/config/app'
import { requestData, type RequestOptions } from './client'

/** 一个采集点位。`nodeKey` 是它在全系统里的身份 `{sourceId}:{pointCode}`。 */
export interface CollectPoint {
  id: string
  sourceId: string
  nodeKey: string
  code: string
  name: string
  dataType: string
  unit: string | null
}

interface CollectPointWire {
  id: string
  source_id: string
  node_key: string
  code: string
  name: string
  data_type: string
  unit: string | null
}

/** 一个采集数据源。 */
export interface CollectSource {
  id: string
  name: string
  protocol: string
}

interface CollectSourceWire {
  id: string
  name: string
  protocol: string
}

export interface PointQuery {
  sourceId?: string | undefined
  q?: string | undefined
  page?: number | undefined
  size?: number | undefined
}

function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

function toPoint(wire: CollectPointWire): CollectPoint {
  return {
    id: wire.id,
    sourceId: wire.source_id,
    nodeKey: wire.node_key,
    code: wire.code,
    name: wire.name,
    dataType: wire.data_type,
    unit: wire.unit,
  }
}

/**
 * 分页找点位。
 * @param query 数据源、关键字与分页
 * @param signal 取消信号；连续输入关键字时用它掐掉在途请求
 */
export async function listPoints(
  query: PointQuery = {},
  signal?: AbortSignal,
): Promise<Page<CollectPoint>> {
  const page = await requestData<Page<CollectPointWire>>(
    '/collect-points',
    onPlatform({
      query: {
        source_id: query.sourceId,
        q: query.q,
        page: query.page,
        size: query.size,
      },
      ...(signal === undefined ? {} : { signal }),
    }),
  )
  return { ...page, items: page.items.map(toPoint) }
}

/** 列出数据源，给挑点面板做一级筛选。 */
export async function listSources(
  query: { q?: string | undefined; page?: number; size?: number } = {},
): Promise<Page<CollectSource>> {
  const page = await requestData<Page<CollectSourceWire>>(
    '/collect-sources',
    onPlatform({ query }),
  )
  return {
    ...page,
    items: page.items.map((wire) => ({
      id: wire.id,
      name: wire.name,
      protocol: wire.protocol,
    })),
  }
}
