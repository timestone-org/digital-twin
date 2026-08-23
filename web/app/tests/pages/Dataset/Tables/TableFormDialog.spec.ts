/**
 * @fileoverview 建表 / 改表弹窗的契约：打开即铺好现值、编码建后锁死、周期以秒
 * 呈现却以毫秒落库、校验挡在提交前、编码被占用要落到那一格上。
 *
 * ⚠ 「打开即铺好现值」这条最容易破：watch 不写 immediate 时，组件在已经是
 * 打开态时被挂载，表单会是空的，而看上去只是「用户自己没填」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetTable, DatasetTableSummary } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as dataset from '@/api/dataset'
import TableFormDialog from '@/pages/Dataset/Tables/components/TableFormDialog.vue'

const STAMP = '2026-01-01T00:00:00.000Z'

function summary(over: Partial<DatasetTableSummary> = {}): DatasetTableSummary {
  return {
    id: 't1',
    code: 'energy_log',
    name: '能耗台账',
    description: '每小时一行',
    collect_mode: 'aggregate',
    collect_interval_ms: 3_600_000,
    retention_days: 90,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 3,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function created(): DatasetTable {
  return { ...summary({ id: 'new' }), columns: [] }
}

beforeEach(() => {
  vi.spyOn(dataset, 'createDatasetTable').mockResolvedValue(created())
  vi.spyOn(dataset, 'updateDatasetTable').mockResolvedValue(created())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function open(table: DatasetTableSummary | null) {
  const wrapper = mount(TableFormDialog, {
    props: { modelValue: true, table },
  })
  await flushPromises()
  return wrapper
}

function inputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.dt-input__el')]
}

async function type(index: number, value: string): Promise<void> {
  const field = inputs()[index]
  if (field === undefined) throw new Error(`第 ${index} 个输入框不存在`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

function clickByText(text: string): void {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  )
  button?.click()
}

async function save(): Promise<void> {
  clickByText('保存')
  await flushPromises()
}

describe('建表 / 改表弹窗', () => {
  it('新建时是空表单', async () => {
    await open(null)
    expect(inputs()[0]?.value).toBe('')
    expect(inputs()[1]?.value).toBe('')
  })

  it('编辑时打开即铺好名称与编码', async () => {
    await open(summary())
    expect(inputs()[0]?.value).toBe('能耗台账')
    expect(inputs()[1]?.value).toBe('energy_log')
  })

  it('⚠ 编辑时编码锁死：它是大屏绑定键的前半段，改一次全部绑定悬空', async () => {
    await open(summary())
    expect(inputs()[1]?.disabled).toBe(true)
    expect(document.body.textContent).toContain('建后不可改')
  })

  it('新建时编码可填，且跟着名称自动给一个建议', async () => {
    await open(null)
    await type(0, 'Energy Log')
    expect(inputs()[1]?.value).toBe('energy_log')
  })

  it('⚠ 手打过编码之后就再也不被名称覆盖', async () => {
    await open(null)
    await type(1, 'my_code')
    await type(0, '换个名字')
    expect(inputs()[1]?.value).toBe('my_code')
  })

  it('周期按秒填、按毫秒提交', async () => {
    await open(null)
    await type(0, '能耗')
    await type(1, 'energy')
    await save()
    expect(dataset.createDatasetTable).toHaveBeenCalledWith(
      expect.objectContaining({ collect_interval_ms: 60_000 }),
    )
  })

  it('保留期留空即永久，提交的是 null 而不是 0', async () => {
    // ⚠ 0 天在后端是「立刻删光」，与「永久保留」正好相反
    await open(null)
    await type(0, '能耗')
    await type(1, 'energy')
    await save()
    expect(dataset.createDatasetTable).toHaveBeenCalledWith(
      expect.objectContaining({ retention_days: null }),
    )
  })

  it('改表走 PATCH，且提交的补丁里没有 code', async () => {
    const wrapper = await open(summary())
    await save()
    expect(dataset.updateDatasetTable).toHaveBeenCalledWith(
      't1',
      expect.not.objectContaining({ code: expect.anything() }),
    )
    expect(wrapper.emitted('saved')?.[0]).toEqual(['台账已更新'])
  })

  it('建表成功后报的是这张表的名字', async () => {
    const wrapper = await open(null)
    await type(0, '能耗')
    await type(1, 'energy')
    await save()
    expect(wrapper.emitted('saved')?.[0]).toEqual(['台账「能耗台账」已创建'])
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('名称没填时说清是哪一格错了，而不是点了没反应', async () => {
    await open(null)
    await save()
    expect(dataset.createDatasetTable).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填台账名称')
  })

  it('编码不合法时挡在提交前——后端的 pattern 就是这一条', async () => {
    await open(null)
    await type(0, '能耗')
    await type(1, '_bad code')
    await save()
    expect(dataset.createDatasetTable).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('以字母或数字开头')
  })

  it('⚠ 编码被占用是一句指向某一格的话，不弹成通用失败', async () => {
    vi.mocked(dataset.createDatasetTable).mockRejectedValue(
      new BizError(
        ERROR_CODES.datasetTableCodeTaken,
        '台账编码已被占用',
        409,
        'trace',
      ),
    )
    const wrapper = await open(null)
    await type(0, '能耗')
    await type(1, 'energy')
    await save()
    expect(document.body.textContent).toContain('这个编码已被占用')
    // 弹窗不许关：关掉的话人填的那一堆就全没了
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('其余失败照旧给一句原因，且弹窗不关', async () => {
    vi.mocked(dataset.createDatasetTable).mockRejectedValue(new Error('boom'))
    const wrapper = await open(null)
    await type(0, '能耗')
    await type(1, 'energy')
    await save()
    expect(document.body.textContent).toContain('请求失败')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('点取消只关窗，不发任何请求', async () => {
    const wrapper = await open(null)
    clickByText('取消')
    await flushPromises()
    expect(dataset.createDatasetTable).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })
})
