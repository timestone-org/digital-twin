/** @fileoverview 单点保存后的寻址串校验提示。 */
import { beforeEach, expect, it, vi } from 'vitest'

import * as collect from '@/api/collect'
import { usePointOps } from '@/pages/Collect/scripts/usePointOps'

const toast = vi.hoisted(() => ({
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@dt/ui', () => ({
  useToast: () => toast,
  useConfirm: vi.fn(),
}))

vi.mock('@/api/collect', () => ({ createPoints: vi.fn() }))

const point = { code: 'temperature', name: '温度', address: 'ns=2;s=T' }

beforeEach(() => {
  vi.clearAllMocks()
})

it.each(['采集侧暂不支持寻址串校验', '数据源当前没有活会话', '采集侧未答复'])(
  '保存后显示未校验详情：%s',
  async (detail) => {
    vi.mocked(collect.createPoints).mockResolvedValue({
      items: [],
      address_checks: [
        { address: point.address, status: 'unverified', detail },
      ],
    })

    expect(await usePointOps(() => 'source').create(point)).toBe(true)
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(detail)
    expect(toast.success).toHaveBeenCalledWith('点位已创建')
  },
)

it('缺少详情时仍提示未校验', async () => {
  vi.mocked(collect.createPoints).mockResolvedValue({
    items: [],
    address_checks: [
      { address: point.address, status: 'unverified', detail: null },
    ],
  })

  expect(await usePointOps(() => 'source').create(point)).toBe(true)
  expect(toast.warning).toHaveBeenCalledWith(
    '寻址串这次没能到现场确认，采集起来之后请核对是否有值',
  )
})
