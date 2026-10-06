/** @fileoverview JSON 多点位导入在真实 DOM 中的字段选择、预览、归档和错误契约。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { CollectPoint } from '@dt/contracts'
import * as collect from '@/api/collect'
import HttpPointMappingDialog from '@/pages/Collect/Opcua/components/HttpPointMappingDialog.vue'

enableAutoUnmount(afterEach)
beforeEach(() => {
  document.body.innerHTML = ''
  vi.spyOn(collect, 'listPoints').mockResolvedValue({
    items: [],
    page: 1,
    size: 100,
    total: 0,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})
async function render(): Promise<VueWrapper> {
  const wrapper = mount(HttpPointMappingDialog, {
    props: { modelValue: true, sourceId: 'http-source' },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  return wrapper
}
async function press(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('button').find((node) => node.text() === label)
  if (button === undefined) throw new Error(`没有按钮 ${label}`)
  await button.trigger('click')
  await flushPromises()
}

function point(code = 'point_1'): CollectPoint {
  return {
    id: code,
    source_id: 'http-source',
    node_key: `http-source:${code}`,
    code,
    name: code,
    address: '$',
    data_type: 'int',
    unit: null,
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60000,
    archive_retention_days: null,
    created_at: '2026-10-05T00:00:00Z',
    updated_at: '2026-10-05T00:00:00Z',
  }
}

describe('HTTP JSON 点位映射', () => {
  it('真实表格显示每个路径的值，可勾选多个字段并沿用归档请求', async () => {
    const created = vi.spyOn(collect, 'createPoints').mockResolvedValue({
      items: [point('temperature'), point('data_running')],
      address_checks: [],
    })
    const wrapper = await render()
    await wrapper
      .find('textarea')
      .setValue('{"data":{"temperature":23.5,"running":true,"status":"ok"}}')
    await press(wrapper, '解析并预览')
    const table = wrapper.find('table')
    expect(table.text()).toContain('/data/temperature')
    expect(table.text()).toContain('23.5')
    expect(table.text()).toContain('true')
    expect(table.text()).toContain('ok')
    await wrapper.find('input[aria-label="选择 /data/status"]').setValue(false)
    await wrapper
      .find('input[aria-label="/data/temperature 的点位编码"]')
      .setValue('temperature')
    await press(wrapper, '创建 2 个点位')
    expect(created).toHaveBeenCalledWith(
      {
        source_id: 'http-source',
        items: [
          {
            code: 'temperature',
            name: 'temperature',
            address: '/data/temperature',
            data_type: 'float',
            sampling_interval_ms: 1000,
            archive_enabled: true,
            deadband: 0,
            archive_retention_days: null,
          },
          {
            code: 'data_running',
            name: 'running',
            address: '/data/running',
            data_type: 'bool',
            sampling_interval_ms: 1000,
            archive_enabled: true,
            deadband: 0,
            archive_retention_days: null,
          },
        ],
      },
      expect.any(String),
    )
    expect(wrapper.emitted('imported')).toHaveLength(1)
    expect(wrapper.text()).toContain('已创建 2 个点位')
  })
  it('JSON 格式错误、空字段及 null 均在 DOM 中说明', async () => {
    const wrapper = await render()
    await wrapper.find('textarea').setValue('{')
    await press(wrapper, '解析并预览')
    expect(wrapper.text()).toContain('有效 JSON')
    expect(wrapper.find('table').exists()).toBe(false)
    await wrapper.find('textarea').setValue('{"value":null}')
    await press(wrapper, '解析并预览')
    expect(wrapper.text()).toContain('跳过 1 个 null 字段')
    expect(wrapper.text()).toContain('解析后在这里选择字段')
  })
  it('编码冲突与提交失败不冒充导入成功', async () => {
    const created = vi
      .spyOn(collect, 'createPoints')
      .mockRejectedValue(new Error('接口保存失败'))
    const wrapper = await render()
    await wrapper.find('textarea').setValue('{"a":1,"b":2}')
    await press(wrapper, '解析并预览')
    await wrapper.find('input[aria-label="/b 的点位编码"]').setValue('a')
    expect(wrapper.text()).toContain('编码无效、重复或已存在')
    await press(wrapper, '创建 2 个点位')
    expect(created).not.toHaveBeenCalled()
    await wrapper.find('input[aria-label="/b 的点位编码"]').setValue('b')
    await press(wrapper, '创建 2 个点位')
    expect(wrapper.text()).toContain('创建失败')
    expect(wrapper.emitted('imported')).toBeUndefined()
  })
  it('关闭时取消旧来源的编码扫描，后返回不覆盖新来源', async () => {
    let resolveOld:
      | ((value: Awaited<ReturnType<typeof collect.listPoints>>) => void)
      | undefined
    vi.mocked(collect.listPoints).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      }),
    )
    const wrapper = await render()
    await wrapper.setProps({ sourceId: 'new-http-source' })
    await flushPromises()
    resolveOld?.({ items: [point()], page: 1, size: 100, total: 1 })
    await flushPromises()
    await wrapper.find('textarea').setValue('1')
    await press(wrapper, '解析并预览')
    expect(wrapper.find('input[aria-label="$ 的点位编码"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('无法读取已有点位')
    expect(wrapper.text()).not.toContain('编码无效、重复或已存在')
  })
  it('可修改名称、类型与采样/归档参数，取消按钮真实关闭弹窗', async () => {
    const created = vi.spyOn(collect, 'createPoints').mockResolvedValue({
      items: [point('temperature')],
      address_checks: [
        { address: '/temperature', status: 'unverified', detail: null },
      ],
    })
    const wrapper = await render()
    await wrapper.find('textarea').setValue('{"temperature":"21.5"}')
    await press(wrapper, '解析并预览')
    await wrapper
      .find('input[aria-label="/temperature 的点位名称"]')
      .setValue('接口温度')
    await wrapper
      .find('[aria-label="/temperature 的数据类型"]')
      .trigger('click')
    await flushPromises()
    const float = [
      ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((node) => node.textContent === 'float')
    if (float === undefined) throw new Error('没有浮点类型')
    float.click()
    await flushPromises()
    const numbers = wrapper.findAll('input[role="spinbutton"]')
    await numbers[0]?.setValue('2000')
    await numbers[0]?.trigger('change')
    await numbers[1]?.setValue('0.5')
    await numbers[1]?.trigger('change')
    await numbers[2]?.setValue('30')
    await numbers[2]?.trigger('change')
    await press(wrapper, '创建 1 个点位')
    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            name: '接口温度',
            data_type: 'float',
            sampling_interval_ms: 2000,
            deadband: 0.5,
            archive_retention_days: 30,
          }),
        ],
      }),
      expect.any(String),
    )
    expect(wrapper.text()).toContain('字段尚未现场校验')
    await press(wrapper, '关闭')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })
  it('可关闭归档且恶意样例只作为文本显示', async () => {
    const created = vi
      .spyOn(collect, 'createPoints')
      .mockResolvedValue({ items: [point('label')], address_checks: [] })
    const wrapper = await render()
    await wrapper
      .find('textarea')
      .setValue('{"label":"<img src=x onerror=alert(1)>"}')
    await press(wrapper, '解析并预览')
    expect(wrapper.find('table').text()).toContain(
      '<img src=x onerror=alert(1)>',
    )
    expect(wrapper.find('img').exists()).toBe(false)
    const archiveSwitch = wrapper.find('[role="switch"]')
    await archiveSwitch.trigger('click')
    await press(wrapper, '创建 1 个点位')
    expect(created).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            archive_enabled: false,
            deadband: 0,
            archive_retention_days: null,
          }),
        ],
      }),
      expect.any(String),
    )
  })
  it('编码预检失败时明确提示并阻止提交', async () => {
    vi.mocked(collect.listPoints).mockRejectedValue(new Error('预检失败'))
    const created = vi.spyOn(collect, 'createPoints')
    const wrapper = await render()
    expect(wrapper.text()).toContain('无法读取已有点位')
    await wrapper.find('textarea').setValue('1')
    await press(wrapper, '解析并预览')
    await press(wrapper, '创建 1 个点位')
    expect(created).not.toHaveBeenCalled()
  })
  it('大整数预览提示使用字符串，JSON.parse 舍入值不会冒充原值', async () => {
    const wrapper = await render()
    await wrapper.find('textarea').setValue('{"large":9007199254740993}')
    await press(wrapper, '解析并预览')
    expect(wrapper.text()).toContain('上游应将大整数作为 JSON 字符串返回')
    expect(wrapper.find('table').text()).toContain('无法精确预览')
    expect(wrapper.find('table').text()).not.toContain('9007199254740992')
  })
  it('未修改时遮罩关闭事件贯通到外层', async () => {
    const wrapper = await render()
    await wrapper.find('.dt-modal__backdrop').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })
})
