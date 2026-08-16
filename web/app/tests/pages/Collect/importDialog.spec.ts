/**
 * @fileoverview 批量导入弹窗的预检与提交。
 *
 * ⚠ 三类问题必须分开讲，混成一句「导入失败」用户就只能一行行试：
 * 读不了的行（改文件）、文件内撞码（改文件）、库里已存（可以跳过）。
 * ⚠ 已有编码要**全量**扫：只比对当前页，第二页往后的冲突要到提交时才以 409
 * 冒出来，而那时整批已经被拒了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { CollectPoint } from '@dt/contracts'
import { DtFilePicker } from '@dt/ui'

import * as collectApi from '@/api/collect'
import ImportPointsDialog from '@/pages/Collect/OpcuaSourceDetail/components/ImportPointsDialog.vue'

const HEADER = '点位编码,名称,寻址串'

function point(code: string): CollectPoint {
  return {
    id: code,
    source_id: 's1',
    node_key: `s1:${code}`,
    code,
    name: code,
    address: `ns=2;s=${code}`,
    data_type: 'float',
    unit: null,
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60_000,
    archive_retention_days: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}

/** 造一个只认 `text()` 的 File 假件：happy-dom 的 File 不带 text()。 */
function csvFile(body: string): File {
  return { name: 'points.csv', text: () => Promise.resolve(body) } as File
}

function listing(items: CollectPoint[]): {
  items: CollectPoint[]
  page: number
  size: number
  total: number
} {
  return { items, page: 1, size: 100, total: items.length }
}

async function render(existing: CollectPoint[] = []): Promise<VueWrapper> {
  vi.spyOn(collectApi, 'listPoints').mockResolvedValue(listing(existing))
  const wrapper = mount(ImportPointsDialog, {
    props: { modelValue: false, sourceId: 's1' },
    attachTo: document.body,
  })
  // 弹窗在「打开」的那一刻才扫已有编码，故先合后开
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

/**
 * 选一份 CSV 进去。
 * ⚠ 按组件本体找而不是按名字找：名字是字符串，写错了 `findComponent` 会回一个
 * 空壳而不是报错，用例于是「什么都没选」却照样绿。
 */
async function select(wrapper: VueWrapper, body: string): Promise<void> {
  wrapper.findComponent(DtFilePicker).vm.$emit('select', [csvFile(body)])
  await flushPromises()
}

function bodyButton(prefix: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find((one) =>
    (one.textContent ?? '').trim().startsWith(prefix),
  )
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('预检', () => {
  it('可导入的行数报出来', async () => {
    const wrapper = await render()
    await select(wrapper, `${HEADER}\nt1,温度,ns=2;s=T1\nt2,压力,ns=2;s=P1`)

    expect(document.body.textContent).toContain('可导入 2 行')
  })

  it('读不了的行单独计数，并列出行号与原因', async () => {
    const wrapper = await render()
    await select(wrapper, `${HEADER}\n,缺编码,ns=2;s=T1\nt2,压力,ns=2;s=P1`)

    const text = document.body.textContent ?? ''
    expect(text).toContain('读不了 1 行')
    expect(text).toContain('第 1 行')
    expect(text).toContain('点位编码不能为空')
  })

  it('⚠ 文件内撞码只能改文件——按钮直接禁掉，跳过开关救不了它', async () => {
    const wrapper = await render()
    await select(wrapper, `${HEADER}\nt1,温度,ns=2;s=T1\nt1,温度二,ns=2;s=T2`)

    expect(document.body.textContent).toContain('文件内重复 1 个')
    expect(bodyButton('导入')?.disabled).toBe(true)
  })

  it('缺必填列时整表拒绝', async () => {
    const wrapper = await render()
    await select(wrapper, '名称\n温度')

    expect(document.body.textContent).toContain('表头缺少必填列')
  })

  it('⚠ 库里已存的编码标出来，且默认跳过它们', async () => {
    const wrapper = await render([point('t1')])
    await select(wrapper, `${HEADER}\nt1,温度,ns=2;s=T1\nt2,压力,ns=2;s=P1`)

    const text = document.body.textContent ?? ''
    expect(text).toContain('编码已存在 1 个')
    // 跳过之后只剩一条会提交
    expect(bodyButton('导入 1 个点位')).toBeDefined()
  })

  it('已有编码是全量扫出来的，不只看第一页', async () => {
    const list = vi.spyOn(collectApi, 'listPoints')
    list.mockResolvedValueOnce({
      items: [point('t1')],
      page: 1,
      size: 100,
      total: 2,
    })
    list.mockResolvedValueOnce({
      items: [point('t2')],
      page: 2,
      size: 100,
      total: 2,
    })
    const wrapper = mount(ImportPointsDialog, {
      props: { modelValue: false, sourceId: 's1' },
      attachTo: document.body,
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await select(wrapper, `${HEADER}\nt2,压力,ns=2;s=P1`)

    expect(list).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('编码已存在 1 个')
  })

  it('已有编码取不到时如实说，不假装预检过了', async () => {
    vi.spyOn(collectApi, 'listPoints').mockRejectedValue(new Error('库挂了'))
    const wrapper = mount(ImportPointsDialog, {
      props: { modelValue: false, sourceId: 's1' },
      attachTo: document.body,
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await select(wrapper, `${HEADER}\nt1,温度,ns=2;s=T1`)

    expect(document.body.textContent).toContain('取不到已有点位')
  })
})

describe('提交', () => {
  it('按批调后端，并在完成后通知外面刷新', async () => {
    const create = vi.spyOn(collectApi, 'createPoints').mockResolvedValue({
      items: [point('t1')],
      address_checks: [
        { address: 'ns=2;s=T1', status: 'passed', detail: null },
      ],
    })
    const wrapper = await render()
    await select(wrapper, `${HEADER}\nt1,温度,ns=2;s=T1`)
    bodyButton('导入')?.click()
    await flushPromises()

    expect(create).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('imported')).toHaveLength(1)
    expect(document.body.textContent).toContain('已建 1 个点位')
  })

  it('⚠ 没到现场确认过的寻址串要说出来，不混进「成功」里', async () => {
    vi.spyOn(collectApi, 'createPoints').mockResolvedValue({
      items: [point('t1')],
      address_checks: [
        { address: 'ns=2;s=T1', status: 'unverified', detail: '采集侧离线' },
      ],
    })
    const wrapper = await render()
    await select(wrapper, `${HEADER}\nt1,温度,ns=2;s=T1`)
    bodyButton('导入')?.click()
    await flushPromises()

    expect(document.body.textContent).toContain('没有被现场确认过')
  })

  it('⚠ 整批被拒时列出这一批的编码，用户才回得去文件里找', async () => {
    vi.spyOn(collectApi, 'createPoints').mockRejectedValue(
      new Error('编码已存在'),
    )
    const wrapper = await render()
    await select(wrapper, `${HEADER}\nt1,温度,ns=2;s=T1`)
    bodyButton('导入')?.click()
    await flushPromises()

    const text = document.body.textContent ?? ''
    expect(text).toContain('第 1 批')
    expect(text).toContain('t1')
    expect(wrapper.emitted('imported')).toBeUndefined()
  })
})
