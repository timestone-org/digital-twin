/**
 * @fileoverview 分页器的取值契约与纯算术：总页数、条目区间、带省略号的页码序列。
 * 独立成 `.ts` 模块有两个理由：不挂载组件就能把边界（0 条、单页、首尾窗口）钉死；
 * 类型从 `.vue` 里 export 时 typescript-eslint 解析不出来，消费方会报一片 unsafe-any。
 */

/** 不省略时最多直出几个页码。 */
const MAX_PLAIN_PAGES = 7
/** 省略时首尾之间保留的页码个数。 */
const WINDOW = 3

/** 每页条数的缺省备选值。 */
export const DT_PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100]

/**
 * 分页信息。DtDataView 拿到它才渲染分页器，不分页的用法不给这个 prop。
 *
 * ⚠ `page` 是 1 起的页码，与后端 `Page.page` 同一口径；换算成 offset 是调用方的事。
 */
export interface DtPaginationState {
  page: number
  size: number
  total: number
  /** 缺省用 `DT_PAGE_SIZE_OPTIONS`。 */
  sizeOptions?: readonly number[] | undefined
}

export interface DtPageNumberItem {
  kind: 'page'
  page: number
  key: string
}

export interface DtPageGapItem {
  kind: 'gap'
  key: 'gap-start' | 'gap-end'
}

export type DtPageItem = DtPageNumberItem | DtPageGapItem

export interface DtItemRange {
  from: number
  to: number
}

function pageItem(page: number): DtPageNumberItem {
  return { kind: 'page', page, key: `p${page}` }
}

/**
 * 闭区间内的页码项。
 * @param from 起始页码
 * @param to 结束页码
 */
function numbers(from: number, to: number): DtPageNumberItem[] {
  const items: DtPageNumberItem[] = []
  for (let page = from; page <= to; page += 1) items.push(pageItem(page))
  return items
}

/** 总页数。一条都没有也算一页，否则页码条整个消失，看着像控件坏了。 */
export function pageCount(total: number, size: number): number {
  if (size <= 0) return 1
  return Math.max(1, Math.ceil(total / size))
}

/**
 * 把越界或非法的页码收回 `[1, count]`。
 * @param page 调用方给的页码
 * @param count 总页数
 */
export function clampPage(page: number, count: number): number {
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(Math.trunc(page), 1), count)
}

/**
 * 当前页覆盖的条目序号，1 起的闭区间；一条都没有时两端都是 0。
 * @param page 已收回范围内的当前页
 * @param size 每页条数
 * @param total 总条数
 */
export function itemRange(
  page: number,
  size: number,
  total: number,
): DtItemRange {
  if (total <= 0) return { from: 0, to: 0 }
  return { from: (page - 1) * size + 1, to: Math.min(page * size, total) }
}

/**
 * 页码序列：首尾常驻、当前页两侧各留一个，中间折成省略号。
 * @param current 已收回范围内的当前页
 * @param count 总页数
 */
export function buildPageItems(current: number, count: number): DtPageItem[] {
  if (count <= MAX_PLAIN_PAGES) return numbers(1, count)
  let start = Math.max(2, current - 1)
  let end = Math.min(count - 1, current + 1)
  if (current <= WINDOW) {
    start = 2
    end = WINDOW + 1
  } else if (current > count - WINDOW) {
    start = count - WINDOW
    end = count - 1
  }
  const items: DtPageItem[] = [pageItem(1)]
  if (start > 2) items.push({ kind: 'gap', key: 'gap-start' })
  items.push(...numbers(start, end))
  if (end < count - 1) items.push({ kind: 'gap', key: 'gap-end' })
  items.push(pageItem(count))
  return items
}
