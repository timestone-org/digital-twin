/** @fileoverview 工具分页拒绝无效参数，空页和末页明确终止。 */
import { describe, expect, it } from 'vitest'
import { pageItems } from '@/pages/TwinEditor/scripts/aiToolPage'

function call(args: Record<string, unknown>) {
  return { call_id: 'paging', name: 'twin.list_entities', arguments: args }
}

describe('孪生工具分页边界', () => {
  it.each([
    { page: 0 },
    { page: null },
    { limit: null },
    { page: -1 },
    { page: 1.5 },
    { page: true },
    { page: '2' },
    { limit: 0 },
    { limit: 21 },
    { limit: false },
    { keyword: 1 },
  ])('拒绝无效窗口或关键词 %j', (args) => {
    expect(() => pageItems([], call(args))).toThrow()
  })
  it('空页和超过末页都不给下一页', () => {
    expect(pageItems([], call({})).metadata.next_page).toBeNull()
    expect(
      pageItems([{ id: 'one', name: '设备' }], call({ page: 2 })),
    ).toMatchObject({
      items: [],
      metadata: { total: 1, has_more: false, next_page: null },
    })
  })
  it('按名称与id忽略大小写过滤', () => {
    expect(
      pageItems(
        [
          { id: 'PUMP', name: '泵' },
          { id: 'valve', name: '阀' },
        ],
        call({ keyword: ' pump ' }),
      ).items,
    ).toEqual([{ id: 'PUMP', name: '泵' }])
  })
})
