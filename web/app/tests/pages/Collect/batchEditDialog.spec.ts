/** @fileoverview 采集点位的交互与数据完整性契约。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { CollectPoint } from '@dt/contracts'
import * as collect from '@/api/collect'
import BatchEditDialog from '@/pages/Collect/Opcua/components/BatchEditDialog.vue'

vi.mock('@/api/collect', () => ({ updatePoint: vi.fn() }))
const point: CollectPoint = {
  id: 'p1',
  source_id: 's1',
  node_key: 's1:p1',
  code: 'p1',
  name: '温度',
  address: 'ns=2;s=Temp',
  data_type: 'float',
  unit: '℃',
  sampling_interval_ms: 1000,
  deadband: 0,
  archive_enabled: true,
  archive_max_interval_ms: 60000,
  archive_retention_days: null,
  created_at: '',
  updated_at: '',
}
enableAutoUnmount(afterEach)
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
describe('批量编辑交互', () => {
  it('预览之前不能保存，部分失败只重试失败项', async () => {
    const update = vi
      .mocked(collect.updatePoint)
      .mockResolvedValueOnce({ point, address_check: null })
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValue({ point, address_check: null })
    const wrapper = mount(BatchEditDialog, {
      props: { points: [point, { ...point, id: 'p2', name: '压力' }] },
      global: { stubs: { teleport: true } },
    })
    const button = (text: string) => {
      const found = wrapper.findAll('button').find((one) => one.text() === text)
      if (!found) throw new Error(text)
      return found
    }
    expect(button('保存以上修改').attributes('disabled')).toBeDefined()
    await wrapper.find('input').setValue('kPa')
    await button('预览修改').trigger('click')
    expect(wrapper.text()).toContain('修改前')
    expect(wrapper.find('tbody').text()).toContain('kPa')
    expect(update).not.toHaveBeenCalled()
    await button('保存以上修改').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('失败 1 项')
    await button('重试失败项').trigger('click')
    await flushPromises()
    expect(update.mock.calls.map(([id]) => id)).toEqual(['p1', 'p2', 'p2'])
  })
})
