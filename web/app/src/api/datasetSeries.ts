/**
 * @fileoverview 台账列序列的批量取数：把若干条 `dataset` 取数说明折成尽可能少的
 * `GET /dataset-tables/{id}/series`，并把台账那套线形转成历史读侧的 `HistoryPoint`。
 *
 * ⚠ 两套线形不是一回事：台账回的是 `{ts: RFC3339 串, value}`，历史读侧要的是
 * `{t: UTC 毫秒, v}`。逐点转换这一步漏了，时间轴会整条塌成 NaN 而不报任何错。
 * ⚠ `HistoryTimeRange.limit` 在这一支**无处可放**：`:series` 端点只收 since /
 * until，没有 limit 参数（一次最多回 `MAX_SERIES_ROWS` = 20000 行、留的是最新
 * 那批）。故这里显式丢弃它，而不是拼进去假装它生效。
 */
import type { DatasetBindingDetail, HistoryPoint } from '@dt/contracts'
import { parseDatasetBindingKey } from '@dt/contracts'
import { DataSourceError } from '@dt/datasources'

import { getDatasetSeries, listDatasetTables } from './dataset'
import type { SeriesFetchOutcome } from './pointSeries'
import { resolveWindow } from './pointHistories'

/** 一次问多少列，与后端 `MAX_SERIES_KEYS` 同值。 */
const KEYS_PER_CALL = 50

/** 一次拉够台账清单：台账是业务级别的数量，几十张顶天（与绑点面板同款口径）。 */
const TABLE_PAGE_SIZE = 200

/**
 * 台账编码 → 台账 id 的映射，取到一次就缓存住。
 * ⚠ 失败不缓存，故这里存的是那次取数本身：一次网络抖动不该让这一屏此后
 * 永远解不出表。
 * ⚠ 缓存住的这份会旧：同一次会话里新建的台账不在里面，而绑点面板每次挂载都
 * 重拉——于是同一张表在那边挑得到、在图上却报解不出。解不出的编码要先作废
 * 重取一次再判，见 `resolveTables`。
 */
let tableIds: Promise<ReadonlyMap<string, string>> | null = null

/** 一条待取的台账列绑定。 */
export interface DatasetSeriesRequest {
  /** 槽键，回填时按它对号入座。 */
  fieldKey: string
  detail: DatasetBindingDetail
}

/** 一条绑定拆开之后要的那几样。 */
interface Wanted {
  fieldKey: string
  code: string
  columnKey: string
  since: string
  until: string
}

/** 一组并成同一次请求的绑定：同一张表、同一段窗口。 */
interface DatasetGroup {
  tableId: string
  since: string
  until: string
  /** 列标识 → 要它的那些槽键。 */
  slots: Map<string, string[]>
}

/**
 * 取一批台账列序列，按槽键回填结论。
 * ⚠ 一条失败不拖垮整批：解不出表的那几个槽落 `error`，其余照常出数。
 * @param requests 要取的那些绑定
 * @param signal 取消信号
 * @param nowMs 当前时刻，测试注入
 */
export async function readDatasetSeries(
  requests: readonly DatasetSeriesRequest[],
  signal?: AbortSignal,
  nowMs: number = Date.now(),
): Promise<ReadonlyMap<string, SeriesFetchOutcome>> {
  const found = new Map<string, SeriesFetchOutcome>()
  const wanted = planAll(requests, found, nowMs)
  if (wanted.length === 0) return found
  const groups = await groupByTable(wanted, found)
  await Promise.all(
    [...groups.values()].map(async (group) => {
      for (const [fieldKey, outcome] of await readGroup(group, signal)) {
        found.set(fieldKey, outcome)
      }
    }),
  )
  return found
}

/** 清掉台账映射缓存。⚠ 只给测试用。 */
export function __resetDatasetTables(): void {
  tableIds = null
}

/** 逐条拆开取数说明，拆不动的当场落 error。 */
function planAll(
  requests: readonly DatasetSeriesRequest[],
  found: Map<string, SeriesFetchOutcome>,
  nowMs: number,
): Wanted[] {
  const wanted: Wanted[] = []
  for (const request of requests) {
    try {
      wanted.push(planOne(request, nowMs))
    } catch (caught) {
      found.set(request.fieldKey, {
        state: 'error',
        message: failureText(caught),
      })
    }
  }
  return wanted
}

/** 拆一条：身份串拆成编码 + 列标识，范围口径落成两个 ISO 串。 */
function planOne(request: DatasetSeriesRequest, nowMs: number): Wanted {
  const { datasetKey, range } = request.detail
  const parts = parseDatasetBindingKey(datasetKey)
  if (parts === null) {
    throw new DataSourceError(
      'invalid-query',
      `不是台账列身份（应形如 ds:台账编码:列标识）：${datasetKey}`,
    )
  }
  const { fromMs, toMs } = resolveWindow(range, nowMs)
  return {
    fieldKey: request.fieldKey,
    ...parts,
    since: new Date(fromMs).toISOString(),
    until: new Date(toMs).toISOString(),
  }
}

/** 解出 table_id 并按（表, 窗口）分组；解不出的落 error。 */
async function groupByTable(
  wanted: readonly Wanted[],
  found: Map<string, SeriesFetchOutcome>,
): Promise<Map<string, DatasetGroup>> {
  const groups = new Map<string, DatasetGroup>()
  let tables: ReadonlyMap<string, string>
  try {
    tables = await resolveTables(wanted)
  } catch (caught) {
    const message = failureText(caught)
    for (const one of wanted)
      found.set(one.fieldKey, { state: 'error', message })
    return groups
  }
  for (const one of wanted) {
    const tableId = tables.get(one.code)
    if (tableId === undefined) {
      // ⚠ 不预设原因：清单已经重取过一次，剩下的可能是编码写错了、表被删了、
      //   或者这个账号看不到它——挑一个说出来，用户就会照着那一个方向去查
      found.set(one.fieldKey, {
        state: 'error',
        message: `台账清单里没有编码 ${one.code}，解不出这条绑定指向的表`,
      })
      continue
    }
    absorb(groups, tableId, one)
  }
  return groups
}

/** 把一条拆好的绑定并进它该在的那一组。 */
function absorb(
  groups: Map<string, DatasetGroup>,
  tableId: string,
  one: Wanted,
): void {
  const key = JSON.stringify([tableId, one.since, one.until])
  const group = groups.get(key) ?? {
    tableId,
    since: one.since,
    until: one.until,
    slots: new Map<string, string[]>(),
  }
  groups.set(key, group)
  const sharing = group.slots.get(one.columnKey)
  if (sharing === undefined) group.slots.set(one.columnKey, [one.fieldKey])
  else sharing.push(one.fieldKey)
}

/**
 * 这一批要的编码都解得出吗？解不出的先当成缓存旧了，作废重取一次再判。
 * ⚠ 只在吃到缓存时重取：这一拍才拉回来的那份不必再拉一次。
 * ⚠ 重取失败不改判：本来解得出的那几条照常出数，解不出的仍旧按解不出说——
 * 为了一条编码把整批拖成取数失败，是拿一条坏绑定去换一屏图。
 * @param wanted 这一批拆好的绑定
 */
async function resolveTables(
  wanted: readonly Wanted[],
): Promise<ReadonlyMap<string, string>> {
  const first = await loadTableIds()
  if (first.isFresh) return first.tables
  if (wanted.every((one) => first.tables.has(one.code))) return first.tables
  tableIds = null
  try {
    return (await loadTableIds()).tables
  } catch {
    return first.tables
  }
}

/** 一份台账映射，外加它是不是这一拍才拉的。 */
interface TableIds {
  tables: ReadonlyMap<string, string>
  isFresh: boolean
}

/**
 * 台账编码 → id，取一次缓存住。
 * ⚠ 没有 by-code 端点，只能拉一页清单本地匹配；**装不下一页就报错**而不是当成
 * 「没有这张表」——两者在界面上长得一样，而后者会把「翻页没翻到」说成用户配错了。
 * 已知欠账：前端补 `q` 查询参数或后端补一条 by-code 端点，有其一就不必整页拉。
 */
async function loadTableIds(): Promise<TableIds> {
  const cached = tableIds
  if (cached !== null) return { tables: await cached, isFresh: false }
  const loading = readTableIds().catch((caught: unknown) => {
    tableIds = null
    throw caught
  })
  tableIds = loading
  return { tables: await loading, isFresh: true }
}

/** 真去拉那一页台账清单。 */
async function readTableIds(): Promise<ReadonlyMap<string, string>> {
  const page = await listDatasetTables({ size: TABLE_PAGE_SIZE })
  if (page.total > page.items.length) {
    throw new DataSourceError(
      'invalid-query',
      `台账超过一页（共 ${page.total} 张，只拉得到 ${page.items.length} 张），解不出这张表`,
    )
  }
  return new Map(page.items.map((table) => [table.code, table.id]))
}

/** 取一组，成败都落在这一组自己头上。 */
async function readGroup(
  group: DatasetGroup,
  signal?: AbortSignal,
): Promise<Map<string, SeriesFetchOutcome>> {
  const keys = [...group.slots.keys()]
  const readings = new Map<string, readonly HistoryPoint[]>()
  let isTruncated = false
  try {
    for (let at = 0; at < keys.length; at += KEYS_PER_CALL) {
      const result = await getDatasetSeries(
        group.tableId,
        keys.slice(at, at + KEYS_PER_CALL),
        { since: group.since, until: group.until },
        signal,
      )
      if (result.is_truncated) isTruncated = true
      for (const [key, points] of Object.entries(result.series)) {
        readings.set(
          key,
          points.map((one) => ({ t: Date.parse(one.ts), v: one.value })),
        )
      }
    }
  } catch (caught) {
    return failGroup(group.slots, failureText(caught))
  }
  return okGroup(group.slots, readings, isTruncated)
}

/** 整组取到了：逐槽发回各自那条序列。 */
function okGroup(
  slots: ReadonlyMap<string, string[]>,
  readings: ReadonlyMap<string, readonly HistoryPoint[]>,
  isTruncated: boolean,
): Map<string, SeriesFetchOutcome> {
  const found = new Map<string, SeriesFetchOutcome>()
  for (const [columnKey, fieldKeys] of slots) {
    const points = readings.get(columnKey) ?? []
    for (const fieldKey of fieldKeys) {
      found.set(fieldKey, {
        state: 'ok',
        points,
        isTruncated,
        // ⚠ 台账反扫取的是最新那批，触顶砍掉的是更早那一段
        ...(isTruncated ? { truncatedSide: 'early' as const } : {}),
        isStale: false,
      })
    }
  }
  return found
}

/** 整组没取到：这一组的每个槽都说同一句为什么。 */
function failGroup(
  slots: ReadonlyMap<string, string[]>,
  message: string,
): Map<string, SeriesFetchOutcome> {
  const found = new Map<string, SeriesFetchOutcome>()
  for (const fieldKeys of slots.values()) {
    for (const fieldKey of fieldKeys) {
      found.set(fieldKey, { state: 'error', message })
    }
  }
  return found
}

/** 取不到时说给人看的那句。 */
function failureText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}
