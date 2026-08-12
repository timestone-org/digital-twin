/**
 * @fileoverview 「数据与达标」弹窗的行为契约：对象只能从后端给的清单里选、
 * 达标范围留空必须送 null、覆盖式提交要带全、两条取数路径各自防竞态。
 *
 * ⚠ 元素一律按可访问名定位（label 的 `for` / 按钮文字），不按 class：
 * 按 class 定位的用例只能证明「样式钩子还在」，证明不了读屏用户找得到它。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type {
  AcDataBinding,
  AcDataset,
  AcMetricLimit,
  AcSourceObject,
  AcUnit,
} from '@dt/contracts'
import { DtConfirmHost, useConfirm } from '@dt/ui'

import * as hvac from '@/api/hvac'
import AcDataDialog from '@/pages/Hvac/Units/components/AcDataDialog.vue'

const STAMP = '2026-01-01T00:00:00.000Z'

function acUnit(id = 'a1', serial = 'AC-A-101'): AcUnit {
  return {
    id,
    serial,
    name: '东侧机',
    room: { id: 'r1', name: '注塑房' },
    workshop: { id: 'w1', name: '东车间' },
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function catalog(key = 'raw_minute', name = '原始数据'): AcDataset {
  return {
    key,
    name,
    description: '逐分钟记录',
    metrics: [
      {
        key: 'workshop_temp_avg',
        name: '车间温度',
        unit: '℃',
        group: 'temperature',
        is_limitable: true,
        is_charted_by_default: true,
      },
      {
        key: 'workshop_humidity_avg',
        name: '车间湿度',
        unit: '%',
        group: 'humidity',
        is_limitable: true,
        is_charted_by_default: true,
      },
      {
        key: 'fresh_air_temp',
        name: '新风温度',
        unit: '℃',
        group: 'temperature',
        is_limitable: false,
        is_charted_by_default: false,
      },
    ],
  }
}

function sourceObject(name: string, caption: string | null): AcSourceObject {
  return { name, caption, row_count_hint: 100 }
}

function binding(source = 'KTStartData_K01'): AcDataBinding {
  return {
    dataset: 'raw_minute',
    source_object: source,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

/** 手动结算的 promise，用来把两次取数的返回顺序倒过来。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<T>((done) => {
    settle = done
  })
  return { promise, resolve: (value) => settle?.(value) }
}

/* 一律按可访问名定位 */

function controlByLabel(text: string): HTMLElement | null {
  const label = [...document.querySelectorAll('label')].find((node) =>
    node.textContent?.trim().startsWith(text),
  )
  const id = label?.getAttribute('for')
  return id === null || id === undefined ? null : document.getElementById(id)
}

function inputByLabel(text: string): HTMLInputElement {
  const found = controlByLabel(text)
  if (!(found instanceof HTMLInputElement)) {
    throw new Error(`找不到叫「${text}」的输入框`)
  }
  return found
}

async function fill(label: string, value: string): Promise<void> {
  const field = inputByLabel(label)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

function buttonByName(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (node) =>
      node.textContent?.trim() === name ||
      node.getAttribute('aria-label') === name,
  )
  if (found === undefined) throw new Error(`找不到叫「${name}」的按钮`)
  return found
}

async function click(name: string): Promise<void> {
  buttonByName(name).click()
  await flushPromises()
}

/** 打开某个下拉，点掉标签为 label 的那一项。 */
async function pick(field: string, label: string): Promise<void> {
  controlByLabel(field)?.dispatchEvent(
    new MouseEvent('click', { bubbles: true }),
  )
  await flushPromises()
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  )
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

function optionLabels(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map(
    (node) => node.textContent?.trim() ?? '',
  )
}

beforeEach(() => {
  vi.spyOn(hvac, 'listAcDatasets').mockResolvedValue([catalog()])
  vi.spyOn(hvac, 'listAcDataBindings').mockResolvedValue([])
  vi.spyOn(hvac, 'listAcMetricLimits').mockResolvedValue([])
  vi.spyOn(hvac, 'listAcSourceObjects').mockResolvedValue([
    sourceObject('KTStartData_K01', '一号空调'),
    sourceObject('KTStartData_K02', null),
  ])
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function open(unit: AcUnit = acUnit()) {
  const wrapper = mount(AcDataDialog, { props: { modelValue: true, unit } })
  await flushPromises()
  return wrapper
}

describe('还没选中空调时', () => {
  it('不发任何请求——台账页在点开某一行之前 unit 就是 null', async () => {
    mount(AcDataDialog, { props: { modelValue: true, unit: null } })
    await flushPromises()
    expect(vi.mocked(hvac.listAcDataBindings)).not.toHaveBeenCalled()
    expect(vi.mocked(hvac.listAcSourceObjects)).not.toHaveBeenCalled()
  })
})

describe('数据源绑定', () => {
  it('对象清单来自后端，caption 作为次要说明跟在名字后', async () => {
    await open()
    await pick('数据源对象', '')
    expect(optionLabels()).toEqual([
      'KTStartData_K01（一号空调）',
      'KTStartData_K02',
    ])
  })

  it('清单按数据集拉，不是全库对象', async () => {
    await open()
    expect(vi.mocked(hvac.listAcSourceObjects)).toHaveBeenCalledWith(
      'raw_minute',
    )
  })

  it('已经绑过的对象打开即选中', async () => {
    vi.mocked(hvac.listAcDataBindings).mockResolvedValue([binding()])
    await open()
    expect(document.body.textContent).toContain('KTStartData_K01（一号空调）')
  })

  it('选定后保存走 PUT，数据集与对象名一起给', async () => {
    const put = vi
      .spyOn(hvac, 'putAcDataBinding')
      .mockResolvedValue(binding('KTStartData_K02'))
    await open()
    await pick('数据源对象', 'KTStartData_K02')
    await click('保存绑定')
    expect(put).toHaveBeenCalledWith('a1', 'raw_minute', 'KTStartData_K02')
  })

  it('没选对象时保存按钮是禁的，点不出请求', async () => {
    const put = vi.spyOn(hvac, 'putAcDataBinding')
    await open()
    expect(buttonByName('保存绑定').disabled).toBe(true)
    await click('保存绑定')
    expect(put).not.toHaveBeenCalled()
  })

  it('没绑过时不出「解除绑定」——那是个没有对象可解的动作', async () => {
    await open()
    expect(() => buttonByName('解除绑定')).toThrow()
  })

  it('解除绑定要先二次确认，点掉确认框就什么都不做', async () => {
    vi.mocked(hvac.listAcDataBindings).mockResolvedValue([binding()])
    const remove = vi.spyOn(hvac, 'deleteAcDataBinding')
    mount(DtConfirmHost)
    await open()
    await click('解除绑定')
    useConfirm().resolve(false)
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
  })

  it('确认后才真的解除', async () => {
    vi.mocked(hvac.listAcDataBindings).mockResolvedValue([binding()])
    const remove = vi
      .spyOn(hvac, 'deleteAcDataBinding')
      .mockResolvedValue(undefined)
    mount(DtConfirmHost)
    await open()
    await click('解除绑定')
    useConfirm().resolve(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('a1', 'raw_minute')
  })

  it('对象清单取不回来时说出原因，而不是给一个空下拉', async () => {
    vi.mocked(hvac.listAcSourceObjects).mockRejectedValue(
      new Error('外库连不上'),
    )
    await open()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      '请求失败',
    )
  })
})

describe('达标范围', () => {
  it('只给 is_limitable 的指标出输入框，量纲写在标签上', async () => {
    await open()
    expect(inputByLabel('车间温度下限（℃）')).toBeDefined()
    expect(inputByLabel('车间湿度上限（%）')).toBeDefined()
    expect(controlByLabel('新风温度下限')).toBeNull()
  })

  it('打开即铺好已存的取值', async () => {
    const saved: AcMetricLimit[] = [
      { metric: 'workshop_temp_avg', lower_limit: '20.15', upper_limit: '24' },
    ]
    vi.mocked(hvac.listAcMetricLimits).mockResolvedValue(saved)
    await open()
    expect(inputByLabel('车间温度下限（℃）').value).toBe('20.15')
  })

  it('留空的一侧送 null——空是「不限制」，不是 0', async () => {
    const put = vi.spyOn(hvac, 'putAcMetricLimits').mockResolvedValue([])
    await open()
    await fill('车间温度上限（℃）', '24')
    await click('保存达标范围')
    expect(put).toHaveBeenCalledWith('a1', [
      { metric: 'workshop_temp_avg', lower_limit: null, upper_limit: '24' },
      { metric: 'workshop_humidity_avg', lower_limit: null, upper_limit: null },
    ])
  })

  it('被清空的指标照样出现在载荷里，由后端删掉而不是漏送', async () => {
    vi.mocked(hvac.listAcMetricLimits).mockResolvedValue([
      { metric: 'workshop_temp_avg', lower_limit: '20', upper_limit: '24' },
    ])
    const put = vi.spyOn(hvac, 'putAcMetricLimits').mockResolvedValue([])
    await open()
    await fill('车间温度下限（℃）', '')
    await fill('车间温度上限（℃）', '')
    await click('保存达标范围')
    expect(put).toHaveBeenCalledWith('a1', [
      { metric: 'workshop_temp_avg', lower_limit: null, upper_limit: null },
      { metric: 'workshop_humidity_avg', lower_limit: null, upper_limit: null },
    ])
  })

  it('精确小数原样送出去，不经过一次数字化', async () => {
    const put = vi.spyOn(hvac, 'putAcMetricLimits').mockResolvedValue([])
    await open()
    await fill('车间温度下限（℃）', '20.150')
    await click('保存达标范围')
    const sent = vi.mocked(put).mock.calls[0]?.[1]
    expect(sent?.[0]?.lower_limit).toBe('20.150')
  })

  it('下限大于上限时就地拦下，不发请求', async () => {
    const put = vi.spyOn(hvac, 'putAcMetricLimits')
    await open()
    await fill('车间温度下限（℃）', '25')
    await fill('车间温度上限（℃）', '24')
    await click('保存达标范围')
    expect(put).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      '下限不能大于上限',
    )
  })

  it('后端拒绝时把原因显示在表单里', async () => {
    vi.spyOn(hvac, 'putAcMetricLimits').mockRejectedValue(new Error('boom'))
    await open()
    await click('保存达标范围')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      '请求失败',
    )
  })
})

describe('竞态', () => {
  it('换数据集时慢的那次后返回不许盖掉新清单', async () => {
    vi.mocked(hvac.listAcDatasets).mockResolvedValue([
      catalog(),
      catalog('hourly', '小时数据'),
    ])
    const slow = deferred<AcSourceObject[]>()
    const fast = deferred<AcSourceObject[]>()
    vi.mocked(hvac.listAcSourceObjects)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    await open()

    await pick('数据集', '小时数据')
    fast.resolve([sourceObject('HOURLY_K01', null)])
    await flushPromises()
    slow.resolve([sourceObject('过期清单', null)])
    await flushPromises()

    await pick('数据源对象', '')
    expect(optionLabels()).toEqual(['HOURLY_K01'])
  })

  it('连着换两台空调时，先发起那次的现状不许盖掉后一台的', async () => {
    const slow = deferred<AcDataBinding[]>()
    const fast = deferred<AcDataBinding[]>()
    vi.mocked(hvac.listAcDataBindings)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)

    const wrapper = mount(AcDataDialog, {
      props: { modelValue: true, unit: acUnit('a1') },
    })
    await wrapper.setProps({ unit: acUnit('a2', 'AC-B-202') })
    fast.resolve([binding('KTStartData_K02')])
    await flushPromises()
    slow.resolve([binding('KTStartData_K01')])
    await flushPromises()

    expect(document.body.textContent).toContain('KTStartData_K02')
    expect(document.body.textContent).not.toContain('KTStartData_K01')
  })
})
