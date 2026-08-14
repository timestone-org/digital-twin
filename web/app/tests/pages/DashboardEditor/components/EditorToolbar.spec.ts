/**
 * @fileoverview 契约：工具条只抛事件不改文档——每个入口点下去父组件收到什么，
 * 以及对齐 / 分布在条件不满足时**仍然渲染、只是禁用**（藏起来会让人以为功能没了）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import type { SnapConfig } from '@/features/dashboard/canvasSnap'
import { ZOOM_PRESETS, zoomPercent } from '@/features/dashboard/canvasZoom'
import EditorToolbar from '@/pages/DashboardEditor/components/EditorToolbar.vue'

const SNAP: SnapConfig = { mode: 'grid', step: 8, enabled: true, guides: true }

type Props = InstanceType<typeof EditorToolbar>['$props']

function mountBar(over: Partial<Props> = {}) {
  return mount(EditorToolbar, {
    props: {
      isDirty: true,
      canUndo: true,
      canRedo: true,
      saving: false,
      hasConflict: false,
      zoom: null,
      fitScale: 0.46,
      snap: SNAP,
      alignReady: true,
      distributeReady: true,
      ...over,
    },
  })
}

async function openMenu(wrapper: ReturnType<typeof mountBar>, test: string) {
  await wrapper
    .find(`[data-test="${test}"] .dt-select__trigger`)
    .trigger('click')
  await flushPromises()
  return [...document.querySelectorAll('.dt-select-menu__item')]
}

function pick(items: Element[], label: string): void {
  items
    .find((item) => item.textContent?.includes(label) === true)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('文档动作', () => {
  it('撤销 / 重做 / 重新加载 / 保存各抛各的', async () => {
    const wrapper = mountBar()

    for (const key of ['undo', 'redo', 'reload', 'save']) {
      await wrapper.find(`[data-test="${key}"]`).trigger('click')
    }

    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('redo')).toHaveLength(1)
    expect(wrapper.emitted('reload')).toHaveLength(1)
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('没有可撤销的步骤时撤销键禁用', () => {
    const wrapper = mountBar({ canUndo: false, canRedo: false })

    expect(wrapper.find('[data-test="undo"]').attributes('disabled')).toBe('')
    expect(wrapper.find('[data-test="redo"]').attributes('disabled')).toBe('')
  })

  it('版本冲突时挡住保存，只留重新加载这一条出口', () => {
    const wrapper = mountBar({ hasConflict: true })

    expect(wrapper.text()).toContain('版本已过期')
    expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBe('')
    expect(
      wrapper.find('[data-test="reload"]').attributes('disabled'),
    ).toBeUndefined()
  })

  it('没有改动时保存禁用，改动过就亮出未保存', () => {
    expect(
      mountBar({ isDirty: false })
        .find('[data-test="save"]')
        .attributes('disabled'),
    ).toBe('')
    expect(mountBar().text()).toContain('未保存')
  })

  it('每个图标键都真的画出了图标', () => {
    const wrapper = mountBar()

    for (const key of ['undo', 'redo', 'help', 'reload', 'save']) {
      expect(wrapper.find(`[data-test="${key}"] .dt-icon`).exists()).toBe(true)
    }
  })

  it('帮助与整理各抛一次', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-test="help"]').trigger('click')
    await wrapper.find('[data-test="tidy"]').trigger('click')

    expect(wrapper.emitted('help')).toHaveLength(1)
    expect(wrapper.emitted('tidy')).toHaveLength(1)
  })
})

describe('对齐与分布', () => {
  it('六个方向各抛自己的那一档', async () => {
    const wrapper = mountBar()
    const kinds = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom']

    for (const kind of kinds) {
      await wrapper.find(`[data-test="align-${kind}"]`).trigger('click')
    }

    expect(wrapper.emitted('align')?.map(([kind]) => kind)).toEqual(kinds)
  })

  it('两个轴各抛自己的那一档', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-test="distribute-x"]').trigger('click')
    await wrapper.find('[data-test="distribute-y"]').trigger('click')

    expect(wrapper.emitted('distribute')).toEqual([['x'], ['y']])
  })

  it('条件不满足时六键仍在，只是禁用', async () => {
    const wrapper = mountBar({ alignReady: false, distributeReady: false })

    const buttons = ['align-left', 'align-bottom', 'distribute-x']
    for (const key of buttons) {
      expect(wrapper.find(`[data-test="${key}"]`).exists()).toBe(true)
      expect(wrapper.find(`[data-test="${key}"]`).attributes('disabled')).toBe(
        '',
      )
    }
    await wrapper.find('[data-test="align-left"]').trigger('click')
    expect(wrapper.emitted('align')).toBeUndefined()
  })

  it('禁用时的悬浮提示说清还差什么', () => {
    const wrapper = mountBar({ alignReady: false, distributeReady: false })

    expect(
      wrapper.find('[data-test="align-left"]').attributes('title'),
    ).toContain('≥2')
    expect(
      wrapper.find('[data-test="distribute-x"]').attributes('title'),
    ).toContain('≥3')
  })
})

describe('吸附', () => {
  it('总开关与参考线各自只改自己那一项', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-test="snap-enabled"]').trigger('click')
    await wrapper.find('[data-test="snap-guides"]').trigger('click')

    expect(wrapper.emitted('set-snap')).toEqual([
      [{ enabled: false }],
      [{ guides: false }],
    ])
  })

  it('切到像素模式抛的是模式补丁', async () => {
    const wrapper = mountBar()
    const modes = wrapper.findAll('[data-test="snap-mode"] button')

    await modes[1]?.trigger('click')

    expect(wrapper.emitted('set-snap')?.[0]).toEqual([{ mode: 'px' }])
  })

  it('步进档位抛数字而不是字符串', async () => {
    const wrapper = mountBar({ snap: { ...SNAP, mode: 'px' } })

    pick(await openMenu(wrapper, 'snap-step'), '5px')
    await flushPromises()

    expect(wrapper.emitted('set-snap')?.[0]).toEqual([{ step: 5 }])
  })

  it('栅格模式下像素步进不可选', () => {
    const wrapper = mountBar()

    expect(
      wrapper
        .find('[data-test="snap-step"] .dt-select__trigger')
        .attributes('disabled'),
    ).toBe('')
  })
})

describe('画布缩放', () => {
  it('适应窗口这一档显示的是真实倍率', () => {
    const wrapper = mountBar({ zoom: null, fitScale: 0.46 })

    expect(wrapper.find('[data-test="zoom"]').text()).toContain(
      zoomPercent(0.46),
    )
  })

  it('档位是适应窗口加上全部预设', async () => {
    const wrapper = mountBar()

    const items = await openMenu(wrapper, 'zoom')

    expect(items).toHaveLength(ZOOM_PRESETS.length + 1)
  })

  it('选一个固定档位抛出倍率数字', async () => {
    const wrapper = mountBar()

    pick(await openMenu(wrapper, 'zoom'), '100%')
    await flushPromises()

    expect(wrapper.emitted('update:zoom')?.[0]).toEqual([1])
  })

  it('选回适应窗口抛的是 null', async () => {
    const wrapper = mountBar({ zoom: 1 })

    pick(await openMenu(wrapper, 'zoom'), '适应窗口')
    await flushPromises()

    expect(wrapper.emitted('update:zoom')?.[0]).toEqual([null])
  })
})
