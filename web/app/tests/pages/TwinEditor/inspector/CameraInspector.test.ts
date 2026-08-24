/**
 * @fileoverview 契约：视点检查器把「position / target 是坐标点而不是方位角」写在明面上，
 * 且两组坐标都按当前坐标基准显示。
 *
 * ⚠ 与「方位角 / 俯仰角」那套混着填不会报错，只会让镜头飞到一个谁也没想到的
 * 地方；⚠ 视野的区间取自 `MIN_CAMERA_FOV` / `MAX_CAMERA_FOV`，取到 0 或 180
 * 时画面会整个消失而没有任何一处报错，所以不许手抄一份区间。
 */
import {
  MAX_CAMERA_FOV,
  MIN_CAMERA_FOV,
  normalizeTwinConfig,
} from '@dt/twin-config'
import type { TwinCamera } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CameraInspector from '@/pages/TwinEditor/components/inspector/CameraInspector.vue'
import type { TwinFrameView } from '@/pages/TwinEditor/scripts/coordFrame'

/** 基准原点落在世界原点上：这一份用例守的不是坐标基准，读数即世界坐标。 */
const FRAME: TwinFrameView = { mode: 'model', origin: [0, 0, 0] }

function makeCamera(over: Record<string, unknown> = {}): TwinCamera {
  const camera = normalizeTwinConfig({
    cameras: [{ id: 'c1', name: '全景', ...over }],
  }).cameras[0]
  if (camera === undefined) throw new Error('造不出视点')
  return camera
}

function mountCamera(modelValue: TwinCamera = makeCamera()) {
  return mount(CameraInspector, { props: { modelValue, frame: FRAME } })
}

type Wrapper = ReturnType<typeof mountCamera>

function lastCamera(wrapper: Wrapper): TwinCamera {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回视点')
  return events[events.length - 1]?.[0] as TwinCamera
}

function buttonByText(wrapper: Wrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`没有文案为「${text}」的按钮`)
  return found
}

/** 第 `group` 组坐标框（0 = 机位，1 = 注视点）里三个轴的显示值。 */
function axisValues(wrapper: Wrapper, group: number): string[] {
  return ['X', 'Y', 'Z'].map((axis) => {
    const found = wrapper.findAll(`input[aria-label="${axis}"]`)[group]
    if (!found) throw new Error(`没有第 ${group} 组的 ${axis} 输入框`)
    return (found.element as HTMLInputElement).value
  })
}

describe('机位', () => {
  it('两组坐标各有名字', () => {
    const wrapper = mountCamera()

    expect(wrapper.text()).toContain('相机位置')
    expect(wrapper.text()).toContain('注视点')
  })

  // ⚠ 基准没接上时这两组仍是世界坐标，而画面上一点异常都看不出——只能靠这条守
  it('机位与注视点都按当前基准显示读数', () => {
    const wrapper = mount(CameraInspector, {
      props: {
        modelValue: makeCamera({
          position: [12, 4, -25],
          target: [10, 0, -30],
        }),
        frame: { mode: 'center', origin: [10, 0, -30] },
      },
    })

    // 机位相对中心是 (2, 4, 5)；注视点正落在中心上，三个 0
    expect(axisValues(wrapper, 0)).toEqual(['2', '4', '5'])
    expect(axisValues(wrapper, 1)).toEqual(['0', '0', '0'])
  })

  it('明说它与方位角 / 俯仰角那套不通用', () => {
    const wrapper = mountCamera()

    expect(wrapper.text()).toContain('不是方位角')
  })

  it('位置与注视点各改各的，互不串台', async () => {
    const wrapper = mountCamera(makeCamera({ position: [1, 1, 1] }))

    const axes = wrapper.findAll('input[aria-label="X"]')
    await axes[1]?.setValue('7')

    const next = lastCamera(wrapper)
    expect(next.target).toEqual([7, 0, 0])
    expect(next.position).toEqual([1, 1, 1])
  })

  it('「取当前机位」只抛事件，取数由视口做', async () => {
    const wrapper = mountCamera()

    await buttonByText(wrapper, '取当前机位').trigger('click')

    expect(wrapper.emitted('captureCurrent')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

describe('视野', () => {
  it('区间取自契约常量，不手抄一份', () => {
    const wrapper = mountCamera()

    const slider = wrapper.find('input[type="range"]')
    expect(slider.attributes('min')).toBe(String(MIN_CAMERA_FOV))
    expect(slider.attributes('max')).toBe(String(MAX_CAMERA_FOV))
  })

  it('拉滑块整份写回，其余字段原样带上', async () => {
    const camera = makeCamera({ target: [0, 1, 0] })
    const wrapper = mountCamera(camera)

    await wrapper.find('input[type="range"]').setValue('60')

    const next = lastCamera(wrapper)
    expect(next.fov).toBe(60)
    expect(next.target).toEqual([0, 1, 0])
    expect(camera.fov).toBe(45)
  })
})

describe('初始视点', () => {
  it('把「多个都标了只认第一个」说出来', () => {
    const wrapper = mountCamera()

    expect(wrapper.text()).toContain('只认列表里的第一个')
  })

  it('标记整份写回，不就地改 props', async () => {
    const camera = makeCamera()
    const wrapper = mountCamera(camera)

    await buttonByText(wrapper, '打开大屏时用它').trigger('click')

    expect(lastCamera(wrapper).isDefault).toBe(true)
    expect(camera.isDefault).toBe(false)
  })
})

describe('名字', () => {
  it('改名字整份写回', async () => {
    const wrapper = mountCamera()

    await wrapper.find('input[type="text"]:not([role])').setValue('俯视')

    expect(lastCamera(wrapper).name).toBe('俯视')
  })
})
