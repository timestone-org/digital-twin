/** @fileoverview 部件点击配置只展示有效动作，取景来源切换保留两份配置与距离规则。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type {
  TwinCamera,
  TwinClickDistanceRule,
  TwinPartClick,
} from '@dt/twin-config'
import { DtSegmented, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PartClickFields from '@/pages/TwinEditor/components/fields/PartClickFields.vue'

const SPLIT = { farThreshold: { ref: 'orbit', value: 20 } }
const VIEW = { position: [1, 2, 3], target: [0, 0, 0], fov: 45 }

function render(
  over: Record<string, unknown> = {},
  cameras?: readonly TwinCamera[],
) {
  const config = normalizeTwinConfig({
    parts: [{ id: 'p1', ...over }],
    cameras: [{ id: 'c1', name: '总览', position: [4, 5, 6] }],
  })
  const part = config.parts[0]
  if (part === undefined) throw new Error('缺少部件')
  return mount(PartClickFields, {
    props: {
      modelValue: part.click,
      distance: part.clickDistance,
      cameras: cameras ?? config.cameras,
    },
  })
}
type Wrapper = ReturnType<typeof render>

function lastClick(wrapper: Wrapper): TwinPartClick {
  const value: unknown = wrapper.emitted('update:modelValue')?.at(-1)?.[0]
  if (value === undefined) throw new Error('没有写回点击动作')
  const part = normalizeTwinConfig({ parts: [{ click: value }] }).parts[0]
  if (part === undefined) throw new Error('缺少写回部件')
  return part.click
}
function lastDistance(wrapper: Wrapper): TwinClickDistanceRule {
  const value: unknown = wrapper.emitted('update:distance')?.at(-1)?.[0]
  if (value === undefined) throw new Error('没有写回距离')
  const part = normalizeTwinConfig({ parts: [{ clickDistance: value }] })
    .parts[0]
  if (part === undefined) throw new Error('缺少写回部件')
  return part.clickDistance
}
function selectLabeled(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('ariaLabel') === label)
  if (found === undefined) throw new Error(`没有下拉：${label}`)
  return found
}

function renderFar(click: Record<string, unknown> = {}) {
  return render({ click: { far: 'view', ...click }, clickDistance: SPLIT })
}

describe('有效点击动作', () => {
  it('不分距离只显示一个点击动作，且支持直接切视角', () => {
    const wrapper = render()
    const action = selectLabeled(wrapper, '点击动作')
    expect(wrapper.findAllComponents(DtSelect)).toHaveLength(1)
    expect(action.props('modelValue')).toBe('none')
    expect(action.props('options')).toContainEqual({
      value: 'view',
      label: '切换至指定视角',
    })
    action.vm.$emit('update:modelValue', 'view')
    expect(lastClick(wrapper)).toMatchObject({ near: 'view', far: 'approach' })
    expect(wrapper.emitted('update:distance')).toBeUndefined()
  })

  it('开启距离分界后分别配置远近动作，修改一档保留另一档', () => {
    const wrapper = render({ click: { near: 'detail' }, clickDistance: SPLIT })
    const far = selectLabeled(wrapper, '远距点击动作')
    expect(far.props('modelValue')).toBe('approach')
    far.vm.$emit('update:modelValue', 'none')
    expect(lastClick(wrapper)).toMatchObject({ far: 'none', near: 'detail' })
    selectLabeled(wrapper, '近距点击动作').vm.$emit('update:modelValue', 'view')
    expect(lastClick(wrapper)).toMatchObject({ far: 'approach', near: 'view' })
  })

  it('关闭分界只隐藏远距配置，不丢掉已保存的动作和目标', async () => {
    const wrapper = renderFar({ near: 'none', view: VIEW, cameraId: 'c1' })
    const before = wrapper.props('modelValue')
    await wrapper
      .get('button[role="switch"][aria-label="远近距离分界"]')
      .trigger('click')
    await wrapper.setProps({ distance: lastDistance(wrapper) })
    expect(wrapper.props('modelValue')).toEqual(before)
    expect(wrapper.find('[aria-label="远距点击动作"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="part-capture-view"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('远距动作暂不生效')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.setProps({
      distance: {
        ...wrapper.props('distance'),
        farThreshold: { ref: 'orbit', value: 20 },
      },
    })
    expect(selectLabeled(wrapper, '远距点击动作').props('modelValue')).toBe(
      'view',
    )
    expect(wrapper.find('[data-test="part-capture-view"]').exists()).toBe(true)
  })

  it('不分距离时明确说明所有点击都执行同一个动作', () => {
    expect(render().text()).toContain(
      '未设置远近距离分界，所有点击都执行此动作',
    )
  })

  it('远距不响应与近距仅联动的文案区分实际行为', () => {
    const wrapper = render({ clickDistance: SPLIT })
    expect(
      selectLabeled(wrapper, '远距点击动作').props('options'),
    ).toContainEqual({ value: 'none', label: '不响应' })
    expect(
      selectLabeled(wrapper, '近距点击动作').props('options'),
    ).toContainEqual({ value: 'none', label: '仅触发联动' })
    expect(wrapper.text()).toContain('普通点击和近距点击会同时触发联动')
  })

  it.each(['点击动作', '远距点击动作', '近距点击动作'])(
    '拒绝未知的%s',
    (label) => {
      const wrapper = render(
        label === '点击动作' ? {} : { clickDistance: SPLIT },
      )
      selectLabeled(wrapper, label).vm.$emit('update:modelValue', '???')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    },
  )
})

describe('目标视角来源', () => {
  it('两种来源分别显示各自配置，来回切换保留已保存的快照与视点', async () => {
    const wrapper = renderFar({ view: VIEW, cameraId: 'c1' })
    const source = wrapper.findComponent(DtSegmented)
    expect(source.props('modelValue')).toBe('snapshot')
    expect(wrapper.find('[aria-label="预设视点"]').exists()).toBe(false)
    source.vm.$emit('update:modelValue', 'camera')
    expect(lastClick(wrapper)).toMatchObject({
      viewSource: 'camera',
      view: VIEW,
      cameraId: 'c1',
    })
    await wrapper.setProps({ modelValue: lastClick(wrapper) })
    expect(selectLabeled(wrapper, '预设视点').props('modelValue')).toBe('c1')
    expect(wrapper.find('[data-test="part-capture-view"]').exists()).toBe(false)
    source.vm.$emit('update:modelValue', 'snapshot')
    await wrapper.setProps({ modelValue: lastClick(wrapper) })
    expect(wrapper.props('modelValue')).toMatchObject({
      viewSource: 'snapshot',
      view: VIEW,
      cameraId: 'c1',
    })
    expect(wrapper.find('[data-test="part-clear-view"]').exists()).toBe(true)
  })

  it('预设视点可以直接配置给普通点击，切换目标不清除备用快照', () => {
    const wrapper = render({
      click: { near: 'view', far: 'none', viewSource: 'camera', view: VIEW },
    })
    selectLabeled(wrapper, '预设视点').vm.$emit('update:modelValue', 'c1')
    expect(lastClick(wrapper)).toMatchObject({
      near: 'view',
      far: 'none',
      viewSource: 'camera',
      cameraId: 'c1',
      view: VIEW,
    })
    expect(wrapper.emitted('update:distance')).toBeUndefined()
  })

  it('取当前机位由页面保存，没有快照时不显示清除按钮', async () => {
    const wrapper = renderFar({ viewSource: 'snapshot' })
    expect(wrapper.find('[data-test="part-clear-view"]').exists()).toBe(false)
    await wrapper.get('[data-test="part-capture-view"]').trigger('click')
    expect(wrapper.emitted('captureView')).toHaveLength(1)
  })

  it('主动清除快照后回到预设视点，保留已有视点和动作', async () => {
    const wrapper = renderFar({ near: 'detail', view: VIEW, cameraId: 'c1' })
    await wrapper.get('[data-test="part-clear-view"]').trigger('click')
    expect(lastClick(wrapper)).toMatchObject({
      viewSource: 'camera',
      view: null,
      cameraId: 'c1',
      far: 'view',
      near: 'detail',
    })
  })

  it('拒绝未知来源', () => {
    const wrapper = renderFar()
    wrapper.findComponent(DtSegmented).vm.$emit('update:modelValue', '???')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('两档共用一份目标，普通点击已经切视角时不报远档不可达', () => {
    const wrapper = render({ click: { far: 'view', near: 'view', view: VIEW } })
    expect(wrapper.findAllComponents(DtSegmented)).toHaveLength(1)
    expect(wrapper.findAll('[data-test="part-capture-view"]')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('远距动作暂不生效')
  })

  it('没有生效的切视角动作时不展示目标配置', () => {
    const wrapper = render({ click: { far: 'view', near: 'none', view: VIEW } })
    expect(wrapper.findComponent(DtSegmented).exists()).toBe(false)
    expect(wrapper.text()).toContain('远距动作暂不生效')
  })

  it.each(['camera', 'snapshot'])(
    '当前来源 %s 缺少目标时说明聚焦回退',
    (viewSource) => {
      const wrapper = render({ click: { near: 'view', viewSource } })
      expect(wrapper.text()).toContain(
        '当前取景尚未配置完整，点击将自动聚焦部件',
      )
    },
  )

  it('只提示当前使用的视点丢失，不把备用视点当作生效配置', () => {
    const active = renderFar({
      viewSource: 'camera',
      cameraId: 'gone',
      view: VIEW,
    })
    expect(active.text()).toContain('视点 gone 不存在')
    const stored = renderFar({
      viewSource: 'snapshot',
      cameraId: 'gone',
      view: VIEW,
    })
    expect(stored.text()).not.toContain('视点 gone 不存在')
  })
})

describe('可选距离规则', () => {
  it('分界和最小最大距离仍可分别配置', async () => {
    const wrapper = render()
    for (const label of [
      '近于此距离不响应',
      '远于此距离不响应',
      '远近距离分界',
    ]) {
      expect(
        wrapper.find(`button[role="switch"][aria-label="${label}"]`).exists(),
      ).toBe(true)
    }
    await wrapper
      .get('button[role="switch"][aria-label="远近距离分界"]')
      .trigger('click')
    expect(lastDistance(wrapper)).toEqual({
      min: null,
      max: null,
      farThreshold: { ref: 'orbit', value: 30 },
    })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.text()).toContain('阈值不大于 0 或无法获取距离')
  })
})
