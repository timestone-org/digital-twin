/**
 * @fileoverview 契约：拖拽改宽的接线。
 * ⚠ 监听挂在 window 上，所以**卸载必须摘干净**——编辑器一开就是几天，
 * 漏一个就留下一副永远跟着鼠标改宽的监听，而页面上一点报错都没有。
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import {
  PANE_DEFAULTS,
  PANE_MIN_PX,
} from '@/pages/DashboardEditor/scripts/paneWidths'
import {
  useEditorPanes,
  type EditorPanes,
} from '@/pages/DashboardEditor/scripts/useEditorPanes'

const HOST_WIDTH = 1600

/** happy-dom 里元素恒是 0×0，不喂个宽度就一切都被夹到下限，看不出拖拽效果。 */
function stubWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, width, 800),
  )
}

function pointer(type: string, clientX: number): PointerEvent {
  return new PointerEvent(type, { clientX })
}

function mountPanes() {
  const captured: EditorPanes[] = []
  const Host = defineComponent({
    setup() {
      const created = useEditorPanes()
      captured.push(created)
      return () => h('div', { ref: created.hostRef })
    },
  })
  const wrapper = mount(Host, { attachTo: document.body })
  const panes = captured[0]
  if (panes === undefined) throw new Error('组合式函数没跑起来')
  return { wrapper, panes }
}

function drag(clientX: number, type: 'pointermove' | 'pointerup'): void {
  window.dispatchEvent(pointer(type, clientX))
}

beforeEach(() => {
  localStorage.clear()
  stubWidth(HOST_WIDTH)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('拖拽改宽', () => {
  it('左栏跟着指针右移变宽', () => {
    const { panes } = mountPanes()

    panes.startDrag('left', pointer('pointerdown', 100))
    drag(180, 'pointermove')

    expect(panes.left.value).toBe(PANE_DEFAULTS.left + 80)
  })

  // 右栏贴着容器右边，指针右移是把它推窄
  it('右栏的方向是反的', () => {
    const { panes } = mountPanes()

    panes.startDrag('right', pointer('pointerdown', 500))
    drag(560, 'pointermove')

    expect(panes.right.value).toBe(PANE_DEFAULTS.right - 60)
  })

  it('拖过头夹在下限，不会拖成负宽', () => {
    const { panes } = mountPanes()

    panes.startDrag('left', pointer('pointerdown', 900))
    drag(0, 'pointermove')

    expect(panes.left.value).toBe(PANE_MIN_PX)
  })

  it('最宽拖到容器的一半', () => {
    const { panes } = mountPanes()

    panes.startDrag('left', pointer('pointerdown', 0))
    drag(HOST_WIDTH, 'pointermove')

    expect(panes.left.value).toBe(HOST_WIDTH / 2)
  })

  it('松手落档，下次进来还是这个宽度', () => {
    const { panes } = mountPanes()

    panes.startDrag('left', pointer('pointerdown', 100))
    drag(140, 'pointermove')
    drag(140, 'pointerup')

    expect(localStorage.getItem('dt.editor.panes')).toContain(
      String(PANE_DEFAULTS.left + 40),
    )
  })

  it('松手之后再动鼠标不再改宽', () => {
    const { panes } = mountPanes()

    panes.startDrag('left', pointer('pointerdown', 100))
    drag(140, 'pointermove')
    drag(140, 'pointerup')
    drag(900, 'pointermove')

    expect(panes.left.value).toBe(PANE_DEFAULTS.left + 40)
  })

  it('卸载之后再动鼠标不再改宽', () => {
    const { wrapper, panes } = mountPanes()

    panes.startDrag('left', pointer('pointerdown', 100))
    wrapper.unmount()
    drag(900, 'pointermove')

    expect(panes.left.value).toBe(PANE_DEFAULTS.left)
  })
})

describe('键盘与复位', () => {
  it('微调按给的步长走，并当场落档', () => {
    const { panes } = mountPanes()

    panes.nudge('left', 16)

    expect(panes.left.value).toBe(PANE_DEFAULTS.left + 16)
    expect(localStorage.getItem('dt.editor.panes')).toContain('256')
  })

  it('复位回出厂宽度', () => {
    const { panes } = mountPanes()

    panes.nudge('right', 120)
    panes.reset('right')

    expect(panes.right.value).toBe(PANE_DEFAULTS.right)
  })
})

describe('栅格模板', () => {
  it('五列：左栏 / 分隔条 / 画布 / 分隔条 / 右栏', () => {
    const { panes } = mountPanes()

    expect(panes.gridStyle.value.gridTemplateColumns).toBe(
      `${PANE_DEFAULTS.left}px 12px minmax(0, 1fr) 12px ${PANE_DEFAULTS.right}px`,
    )
  })

  it('拖拽期间整块关掉选中', () => {
    const { panes } = mountPanes()

    expect(panes.gridStyle.value.userSelect).toBeUndefined()
    panes.startDrag('left', pointer('pointerdown', 10))

    expect(panes.gridStyle.value.userSelect).toBe('none')
  })
})
