/**
 * @fileoverview 契约：模型检查器只落素材引用、用空串表达「背景透明」、
 * 特效关掉时把字段整段收起来、clips 空数组是「全播」而不是「一条都不播」。
 *
 * ⚠ 素材弹窗 teleport 到 body，断言一律查 `document.body`——查 wrapper 只会拿到
 * 一对空的 teleport 注释，而「找不到」看着像组件没渲染。
 */
import { TWIN_PEDESTAL_REFLECTIONS, normalizeTwinConfig } from '@dt/twin-config'
import type { TwinModelRef } from '@dt/twin-config'
import { DtSelect } from '@dt/ui'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ModelInspector from '@/pages/TwinEditor/components/inspector/ModelInspector.vue'
import type { Vec3 } from '@dt/twin-config'

/** 基准原点，「当前原点」那行读数用。 */
const ORIGIN: Vec3 = [0, 0, 0]

const api = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listAssetKinds: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}))

vi.mock('@/api/assets', () => api)

const ID = '0192f0aa-0000-7000-8000-000000000001'

const ASSET = {
  id: ID,
  ref: `asset:${ID}`,
  kind: 'model' as const,
  name: '机组.glb',
  contentType: 'model/gltf-binary',
  sizeBytes: 2048,
  checksum: 'x',
  createdAt: '2026-08-15T00:00:00.000Z',
  createdBy: 'me',
}

// ⚠ 必须自动卸载：素材弹窗 teleport 到 body，上一条不卸载就直接清 body 时，
// 下一次更新会撞上已被摘掉的 teleport 容器
enableAutoUnmount(afterEach)

function makeModel(over: Record<string, unknown> = {}): TwinModelRef {
  return normalizeTwinConfig({ model: over }).model
}

function mountModel(
  modelValue: TwinModelRef = makeModel(),
  frameOrigin: Vec3 = ORIGIN,
) {
  return mount(ModelInspector, {
    props: { modelValue, frameOrigin },
    attachTo: document.body,
  })
}

type Wrapper = ReturnType<typeof mountModel>

function lastModel(wrapper: Wrapper): TwinModelRef {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回模型')
  return events[events.length - 1]?.[0] as TwinModelRef
}

function buttonByText(wrapper: Wrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`没有文案为「${text}」的按钮`)
  return found
}

function switchByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAll('button[role="switch"]')
    .find((item) => item.text() === label)
  if (!found) throw new Error(`没有名为「${label}」的开关`)
  return found
}

function selectByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === label)
  if (!found) throw new Error(`没有名为「${label}」的下拉`)
  return found
}

beforeEach(() => {
  vi.resetAllMocks()
  api.listAssetKinds.mockResolvedValue([
    {
      kind: 'model',
      label: '三维模型',
      contentTypes: ['model/gltf-binary'],
      maxBytes: 1024 * 1024,
    },
  ])
  api.listAssets.mockResolvedValue([ASSET])
})

describe('坐标基准', () => {
  it('两档都摆在明面上，切一下整份写回', async () => {
    const wrapper = mountModel()

    await buttonByText(wrapper, '模型中心').trigger('click')

    expect(lastModel(wrapper).coordFrame).toBe('center')
  })

  it('缺省是模型原点', () => {
    expect(makeModel().coordFrame).toBe('model')
  })

  // 视口里的参考轴就立在这个点上，写出来用户才对得上
  it('把当前原点的世界坐标写出来', () => {
    const wrapper = mountModel(makeModel(), [10, 0, -30])

    expect(wrapper.text()).toContain('10 / 0 / -30')
  })

  // ⚠ 换基准只换读数：真去挪坐标的话，切一下整场的锚点集体偏移
  it('切基准不碰摆放里的位置', async () => {
    const wrapper = mountModel(makeModel({ position: [4, 1, -2] }))

    await buttonByText(wrapper, '模型中心').trigger('click')

    expect(lastModel(wrapper).position).toEqual([4, 1, -2])
  })
})

describe('模型素材', () => {
  it('挑完落库的是 asset: 引用而不是下载地址', async () => {
    const wrapper = mountModel()

    await buttonByText(wrapper, '选择模型').trigger('click')
    await flushPromises()
    const item = document.body.querySelector('.dt-assets__item')
    if (!(item instanceof HTMLElement)) throw new Error('弹窗里没有素材项')
    item.click()
    await flushPromises()
    const confirm = [...document.body.querySelectorAll('button')].find(
      (button) => (button.textContent ?? '').trim() === '选用',
    )
    confirm?.click()
    await flushPromises()

    expect(lastModel(wrapper).asset).toBe(`asset:${ID}`)
  })

  it('清除把引用清成空串，而不是留一个指不到东西的旧引用', async () => {
    const wrapper = mountModel(makeModel({ asset: `asset:${ID}` }))

    await buttonByText(wrapper, '清除').trigger('click')

    expect(lastModel(wrapper).asset).toBe('')
  })

  it('还没挑模型时清除键是禁用的', () => {
    const wrapper = mountModel()

    expect(buttonByText(wrapper, '清除').attributes('disabled')).toBeDefined()
  })
})

describe('背景', () => {
  it('关掉不透明背景写的是空串——空串才是「透明」', async () => {
    const wrapper = mountModel(makeModel({ background: '#05080f' }))

    await switchByLabel(wrapper, '不透明背景').trigger('click')

    expect(lastModel(wrapper).background).toBe('')
  })

  it('打开不透明背景给一个具体颜色，不留空串', async () => {
    const wrapper = mountModel()

    await switchByLabel(wrapper, '不透明背景').trigger('click')

    expect(lastModel(wrapper).background).not.toBe('')
  })

  it('透明时把「露出下面那层大屏」说出来', () => {
    const wrapper = mountModel()

    expect(wrapper.text()).toContain('背景透明')
  })
})

describe('场景特效', () => {
  it('星空关着时下面的字段整段不在，不留一排灰控件', () => {
    const wrapper = mountModel()

    expect(wrapper.text()).not.toContain('星点密度')
  })

  it('星空开了才露出密度与旋转速度', () => {
    const wrapper = mountModel(
      makeModel({ sceneEffects: { starfield: { enabled: true } } }),
    )

    expect(wrapper.text()).toContain('星点密度')
    expect(wrapper.text()).toContain('旋转速度')
  })

  it('反射档的选项从常量联合生成，不手抄一份', () => {
    const wrapper = mountModel(
      makeModel({ sceneEffects: { pedestal: { enabled: true } } }),
    )

    const options: unknown = selectByLabel(wrapper, '反射').props('options')
    const serialized = JSON.stringify(options)
    for (const value of TWIN_PEDESTAL_REFLECTIONS) {
      expect(serialized).toContain(`"${value}"`)
    }
    expect(options).toHaveLength(TWIN_PEDESTAL_REFLECTIONS.length)
  })

  it('光柱开了才露出模式与上升方式', () => {
    const wrapper = mountModel(
      makeModel({ sceneEffects: { lightColumn: { enabled: true } } }),
    )

    expect(wrapper.text()).toContain('能量罩')
    expect(wrapper.text()).toContain('循环扫描')
  })

  it('改一段特效回的是整份模型，其余两段原样带上', async () => {
    const model = makeModel({ sceneEffects: { starfield: { enabled: true } } })
    const wrapper = mountModel(model)

    await switchByLabel(wrapper, '星云辉光背景').trigger('click')

    const next = lastModel(wrapper)
    expect(next.sceneEffects.starfield.nebula).toBe(true)
    expect(next.sceneEffects.pedestal).toEqual(model.sceneEffects.pedestal)
    expect(model.sceneEffects.starfield.nebula).toBe(false)
  })
})

describe('内置动画', () => {
  it('关着时不露出 clip 清单', () => {
    const wrapper = mountModel()

    expect(wrapper.text()).not.toContain('要播的 clip')
  })

  it('开了之后把「一条都不填 = 全播」说清楚', () => {
    const wrapper = mountModel(makeModel({ animations: { enabled: true } }))

    expect(wrapper.text()).toContain('一条都不填 = 全播')
  })

  it('clip 名可以手填——模型没加载时拿不到候选', async () => {
    const wrapper = mountModel(makeModel({ animations: { enabled: true } }))

    const input = wrapper.find('input[aria-label="手填名字"]')
    await input.setValue('Take 001')
    await wrapper.find('button[aria-label="添加名字"]').trigger('click')

    expect(lastModel(wrapper).animations.clips).toEqual(['Take 001'])
  })
})

describe('摆放', () => {
  it('旋转标明单位是度，不让人按弧度填', () => {
    const wrapper = mountModel()

    expect(wrapper.text()).toContain('旋转（度）')
  })

  it('自动旋转开关整份写回，不就地改 props', async () => {
    const model = makeModel()
    const wrapper = mountModel(model)

    await switchByLabel(wrapper, '自动旋转').trigger('click')

    expect(lastModel(wrapper).autoRotate).toBe(true)
    expect(model.autoRotate).toBe(false)
  })
})
