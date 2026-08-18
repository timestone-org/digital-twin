/**
 * @fileoverview 契约：联动面只把清单标了可交互的节点列进事件源，增删改一律整包
 * 上抛，弹窗标题留空不落键，跨屏跳转只从大屏里挑目标且永不命中的路由要标出来。
 * ⚠ 两条静默的坑由这里钉住：源过滤放宽会让「配了却永远不触发」的规则混进来，
 * 删中间一组若按下标错位，剩下那组会连着别人的目标表一起搬家。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type {
  DashboardNodePayload,
  InteractionRule,
  ModuleManifest,
} from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import InteractionEditor from '@/pages/DashboardEditor/components/InteractionEditor.vue'

function manifest(over: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    type: 'plain',
    displayName: '纯展示',
    category: '演示',
    icon: 'building',
    defaultSize: { width: 10, height: 10 },
    configSchema: [],
    bindings: [],
    component: () => Promise.resolve({ default: {} }),
    ...over,
  }
}

const PLAIN = manifest()
const CLICKABLE = manifest({
  type: 'clickable',
  displayName: '整块可点',
  hostClickable: true,
})
const EMITTER = manifest({
  type: 'emitter',
  displayName: '分段切换',
  emitsInteractions: true,
})

function getManifest(moduleType: string): ModuleManifest | undefined {
  if (moduleType === 'clickable') return CLICKABLE
  if (moduleType === 'emitter') return EMITTER
  if (moduleType === 'plain') return PLAIN
  return undefined
}

function node(id: string, moduleType: string): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

const NODES = [
  node('n1', 'clickable'),
  node('n2', 'emitter'),
  node('n3', 'plain'),
]

function rule(over: Partial<InteractionRule> = {}): InteractionRule {
  return {
    id: 'r1',
    source: { nodeId: 'n1', event: 'click' },
    action: { type: 'show', targets: ['n3'] },
    ...over,
  }
}

function mountEditor(
  rules: InteractionRule[] = [rule()],
  nodes: DashboardNodePayload[] = NODES,
) {
  return mount(InteractionEditor, { props: { rules, nodes, getManifest } })
}

type Editor = ReturnType<typeof mountEditor>

function selectOf(wrapper: Editor, ariaLabel: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('ariaLabel') === ariaLabel)
  if (found === undefined) throw new Error(`没有「${ariaLabel}」这个下拉`)
  return found
}

function lastRules(wrapper: Editor): InteractionRule[] {
  const last = wrapper.emitted<[InteractionRule[]]>('update:rules')?.at(-1)?.[0]
  if (last === undefined) throw new Error('没有上抛 update:rules')
  return last
}

function firstAction(wrapper: Editor) {
  const first = lastRules(wrapper)[0]
  if (first === undefined) throw new Error('上抛的规则表是空的')
  return first.action
}

describe('联动规则编辑面', () => {
  it('事件源只列清单标了可交互的节点', () => {
    const wrapper = mountEditor()

    expect(selectOf(wrapper, '事件源').props('options')).toEqual([
      { value: 'n1', label: '整块可点' },
      { value: 'n2', label: '分段切换' },
    ])
  })

  it('目标节点不做可交互过滤，画布上的都能被控制', () => {
    const wrapper = mountEditor()

    expect(wrapper.findAll('[data-test^="ix-target-"]')).toHaveLength(3)
  })

  it('新增规则整包上抛，新那条挂在第一个可交互节点上', async () => {
    const wrapper = mountEditor()

    await wrapper.find('[data-test="ix-add"]').trigger('click')

    const rules = lastRules(wrapper)
    expect(rules).toHaveLength(2)
    expect(rules[0]).toEqual(rule())
    expect(rules[1]?.source).toEqual({ nodeId: 'n1', event: 'click' })
    expect(rules[1]?.action).toEqual({ type: 'show', targets: [] })
  })

  it('新增规则各自拿到 uuid 形状且互不相同的 id', async () => {
    const wrapper = mountEditor([])

    await wrapper.find('[data-test="ix-add"]').trigger('click')
    const first = lastRules(wrapper)[0]?.id
    await wrapper.find('[data-test="ix-add"]').trigger('click')
    const second = lastRules(wrapper)[0]?.id

    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).not.toBe(first)
  })

  it('删除规则只摘自己那条，其余原样上抛', async () => {
    const wrapper = mountEditor([rule(), rule({ id: 'r2' })])

    await wrapper.findAll('[data-test="ix-remove"]')[1]?.trigger('click')

    expect(lastRules(wrapper).map((item) => item.id)).toEqual(['r1'])
  })

  it('换动作类型时保住已配的目标表', () => {
    const wrapper = mountEditor()

    selectOf(wrapper, '动作类型').vm.$emit('update:modelValue', 'hide')

    expect(firstAction(wrapper)).toEqual({ type: 'hide', targets: ['n3'] })
  })

  it('勾选目标节点后整包上抛新的目标表', async () => {
    const wrapper = mountEditor()

    await wrapper.find('[data-test="ix-target-n2"] input').setValue(true)

    expect(firstAction(wrapper)).toEqual({
      type: 'show',
      targets: ['n3', 'n2'],
    })
  })

  it('互斥切换添一组给出空值空目标的新组', async () => {
    const wrapper = mountEditor([
      rule({ action: { type: 'setActive', groups: [] } }),
    ])

    await wrapper.find('[data-test="ix-group-add"]').trigger('click')

    expect(firstAction(wrapper)).toEqual({
      type: 'setActive',
      groups: [{ value: '', targets: [] }],
    })
  })

  it('删中间一组不动其余组的取值与目标', async () => {
    const groups = [
      { value: 'a', targets: ['n1'] },
      { value: 'b', targets: ['n2'] },
      { value: 'c', targets: ['n3'] },
    ]
    const wrapper = mountEditor([
      rule({ action: { type: 'setActive', groups } }),
    ])

    await wrapper.findAll('[data-test="ix-group-remove"]')[1]?.trigger('click')

    expect(firstAction(wrapper)).toEqual({
      type: 'setActive',
      groups: [groups[0], groups[2]],
    })
  })

  it('改组的选中值只改那一组', async () => {
    const groups = [
      { value: 'a', targets: ['n1'] },
      { value: 'b', targets: ['n2'] },
    ]
    const wrapper = mountEditor([
      rule({ action: { type: 'setActive', groups } }),
    ])

    await wrapper
      .findAll('[data-test="ix-group-value"]')[1]
      ?.setValue('1 号锅炉')

    expect(firstAction(wrapper)).toEqual({
      type: 'setActive',
      groups: [groups[0], { value: '1 号锅炉', targets: ['n2'] }],
    })
  })

  it('弹窗标题填了就落 title 键', async () => {
    const wrapper = mountEditor([
      rule({ action: { type: 'openModal', target: 'n2' } }),
    ])

    await wrapper.find('[data-test="ix-modal-title"]').setValue('设备详情')

    expect(firstAction(wrapper)).toStrictEqual({
      type: 'openModal',
      target: 'n2',
      title: '设备详情',
    })
  })

  it('弹窗标题留空不落 title 键', async () => {
    const wrapper = mountEditor([
      rule({ action: { type: 'openModal', target: 'n2', title: '设备详情' } }),
    ])

    await wrapper.find('[data-test="ix-modal-title"]').setValue('   ')

    expect(firstAction(wrapper)).toStrictEqual({
      type: 'openModal',
      target: 'n2',
    })
  })

  it('挑了目标大屏之后整条动作上抛 navigate', async () => {
    const wrapper = mountEditor([
      rule({ action: { type: 'navigate', target: '' } }),
    ])

    await wrapper.find('[data-test="ix-navigate-target"] input').setValue('d-2')

    expect(firstAction(wrapper)).toEqual({ type: 'navigate', target: 'd-2' })
  })

  it('还没挑目标就说出来——这条规则点了不会跳', () => {
    const wrapper = mountEditor([
      rule({ action: { type: 'navigate', target: '' } }),
    ])

    expect(wrapper.text()).toContain('还没挑目标')
  })

  it('按值跳转添一条给出空值空目标的新路由', async () => {
    const wrapper = mountEditor([
      rule({ action: { type: 'navigateByValue', routes: [] } }),
    ])

    await wrapper.find('[data-test="ix-route-add"]').trigger('click')

    expect(firstAction(wrapper)).toEqual({
      type: 'navigateByValue',
      routes: [{ value: '', target: '' }],
    })
  })

  it('值留空与值重复的路由都标成永不命中', () => {
    const routes = [
      { value: '', target: 'd-1' },
      { value: 'pv', target: 'd-2' },
      { value: 'pv', target: 'd-3' },
    ]
    const wrapper = mountEditor([
      rule({ action: { type: 'navigateByValue', routes } }),
    ])

    const warnings = wrapper
      .findAll('[data-test="ix-route-warning"]')
      .map((item) => item.text())

    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('值留空')
    expect(warnings[1]).toContain('重复')
  })

  it('给某一条路由挑目标只改那一条', async () => {
    const routes = [
      { value: 'pv', target: '' },
      { value: 'ac', target: '' },
    ]
    const wrapper = mountEditor([
      rule({ action: { type: 'navigateByValue', routes } }),
    ])

    await wrapper
      .findAll('[data-test="ix-route-target"] input')[1]
      ?.setValue('d-ac')

    expect(firstAction(wrapper)).toEqual({
      type: 'navigateByValue',
      routes: [routes[0], { value: 'ac', target: 'd-ac' }],
    })
  })

  it('删中间一条路由不动其余条', async () => {
    const routes = [
      { value: 'a', target: 'd-1' },
      { value: 'b', target: 'd-2' },
      { value: 'c', target: 'd-3' },
    ]
    const wrapper = mountEditor([
      rule({ action: { type: 'navigateByValue', routes } }),
    ])

    await wrapper.findAll('[data-test="ix-route-remove"]')[1]?.trigger('click')

    expect(firstAction(wrapper)).toEqual({
      type: 'navigateByValue',
      routes: [routes[0], routes[2]],
    })
  })

  it('关闭弹窗不出任何字段', () => {
    const wrapper = mountEditor([rule({ action: { type: 'closeModal' } })])

    expect(wrapper.find('[data-test="ix-modal-title"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test^="ix-target-"]')).toHaveLength(0)
  })

  it('没有可交互节点时只给空态，不摆空下拉', () => {
    const wrapper = mountEditor([], [node('n3', 'plain')])

    expect(wrapper.find('[data-test="ix-empty"]').text()).toContain(
      '还没有可交互的模块',
    )
    expect(wrapper.findAllComponents(DtSelect)).toHaveLength(0)
    expect(wrapper.find('[data-test="ix-add"]').exists()).toBe(false)
  })

  it('规则摘要报出源节点名、事件与动作', () => {
    const wrapper = mountEditor()

    expect(wrapper.find('[data-test="ix-summary"]').text()).toBe(
      '整块可点 · 点击 → 显示目标（1 个）',
    )
  })
})

describe('按选中节点过滤', () => {
  const OTHER = rule({
    id: 'r2',
    source: { nodeId: 'n2', event: 'change' },
    action: { type: 'hide', targets: ['n2'] },
  })

  function mountFocused(nodeId: string) {
    return mount(InteractionEditor, {
      props: {
        rules: [rule(), OTHER],
        nodes: NODES,
        getManifest,
        focusNodeId: nodeId,
      },
    })
  }

  it('当触发源的规则列出来', () => {
    expect(mountFocused('n1').findAll('[data-test="ix-rule"]')).toHaveLength(1)
  })

  it('被别人控制的规则也列出来——它自己不能当触发源也一样', () => {
    const wrapper = mountFocused('n3')

    expect(wrapper.findAll('[data-test="ix-rule"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="ix-empty"]').exists()).toBe(false)
  })

  it('与自己无关的规则不列', () => {
    const summaries = mountFocused('n3')
      .findAll('[data-test="ix-summary"]')
      .map((item) => item.text())

    expect(summaries).toEqual(['整块可点 · 点击 → 显示目标（1 个）'])
  })

  // ⚠ 过滤只影响看得见哪几条：按可见子集写回会把别人的规则整批删掉
  it('删掉可见的那条时，别的节点的规则原样留着', async () => {
    const wrapper = mountFocused('n1')

    await wrapper.get('[data-test="ix-remove"]').trigger('click')

    expect(lastRules(wrapper).map((item) => item.id)).toEqual(['r2'])
  })

  it('新规则默认从选中的这个节点出发', async () => {
    const wrapper = mountFocused('n2')

    await wrapper.get('[data-test="ix-add"]').trigger('click')

    expect(lastRules(wrapper).at(-1)?.source.nodeId).toBe('n2')
  })
})
