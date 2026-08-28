/**
 * @fileoverview 契约：带预览的样式编辑面——左栏直接复用 `StylePane`（不另摆一套字段）
 * 且关掉它自带的那张小预览，右栏那张画的是**当下生效**的那一份，六路改动原样上抛。
 *
 * ⚠ 左栏另摆一套字段就是同一份样式有两处写入口，两边对「什么时候落一份覆盖」的判断
 * 一旦漂开，界面上只表现为「在这儿改的没生效」。这里正面断言左栏就是 `StylePane`。
 * ⚠ 预览必须取文档里那份覆盖，不能直接读预置库：读预置库的话，改一个内置样式在这张
 * 面上永远看不出变化，而画布上早就变了（§13.4）。
 * ⚠ 本面叠在样式库抽屉之上，`layer` 必须调高：同一层的弹窗 z-index 相同、谁在上全看
 * 挂载次序，抽屉挂得早就会把它整个盖住，且一处都不报错。
 * ⚠ 图元剪贴板与「选中的是哪一枚图元」都归页面持有，本面只转发：在这儿另起一份本地
 * 选中的话，⌘C / ⌘V 与面上那两枚键操作的会是两枚不同的图元。
 */
import { TWIN_2D_BUILTIN_NODE_STYLES, normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNodeStyle } from '@dt/twin2d'
import { DtModal } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StylePane from '@/pages/Twin2dEditor/components/inspector/StylePane.vue'
import Twin2dStylePreview from '@/pages/Twin2dEditor/components/Twin2dStylePreview.vue'
import Twin2dStyleWizard from '@/pages/Twin2dEditor/components/Twin2dStyleWizard.vue'

/** 夹具坏了要当场炸，不能悄悄退化成一个空样式。 */
function throwMissing(): never {
  throw new Error('预置库是空的')
}

const BUILTIN: Twin2dNodeStyle =
  TWIN_2D_BUILTIN_NODE_STYLES[0] ?? throwMissing()

/** 文档里压着一份同 id 的覆盖，外加一份自建样式。 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  styles: [
    { ...BUILTIN, name: '改过的内置' },
    { id: 'own', name: '我的样式', size: { w: 60, h: 40 } },
  ],
})

function mountWizard(styleId = 'own', config: Twin2dConfig = CONFIG) {
  return mount(Twin2dStyleWizard, {
    props: { open: true, config, styleId, selectedPrim: '' },
    global: { stubs: { Teleport: true } },
  })
}

type Wrapper = ReturnType<typeof mountWizard>

/**
 * 左栏那副配置面。
 * @param wrapper 挂好的编辑面
 */
function pane(wrapper: Wrapper) {
  return wrapper.getComponent(StylePane)
}

describe('两栏的分工', () => {
  it('左栏直接复用 StylePane，不另摆一套字段', () => {
    const wrapper = mountWizard()

    expect(wrapper.findComponent(StylePane).exists()).toBe(true)
    expect(pane(wrapper).props('focus')).toEqual({ kind: 'styles', id: 'own' })
  })

  it('左栏那张小预览关掉，两张一起摆会把配置挤出屏外', () => {
    expect(pane(mountWizard()).props('showPreview')).toBe(false)
  })

  it('右栏摆一张预览，就一张', () => {
    const wrapper = mountWizard()

    expect(wrapper.findAllComponents(Twin2dStylePreview)).toHaveLength(1)
  })

  it('图元选中归页面持有，本面原样递下去', () => {
    const wrapper = mount(Twin2dStyleWizard, {
      props: { open: true, config: CONFIG, styleId: 'own', selectedPrim: 'p1' },
      global: { stubs: { Teleport: true } },
    })

    expect(pane(wrapper).props('selectedPrim')).toBe('p1')
  })
})

describe('预览取的是哪一份', () => {
  it('自建样式取文档里那一份', () => {
    const preview = mountWizard().getComponent(Twin2dStylePreview)

    expect(preview.props('nodeStyle')).toMatchObject({ name: '我的样式' })
  })

  it('内置样式取文档里那份覆盖，不是预置库那一份', () => {
    const preview = mountWizard(BUILTIN.id).getComponent(Twin2dStylePreview)

    expect(preview.props('nodeStyle')).toMatchObject({ name: '改过的内置' })
  })

  it('没被覆盖过的内置样式落回预置库那一份，照样画得出来', () => {
    const clean = normalizeTwin2dConfig({ styles: [] })
    const preview = mountWizard(BUILTIN.id, clean).getComponent(
      Twin2dStylePreview,
    )

    expect(preview.props('nodeStyle')).toMatchObject({ id: BUILTIN.id })
  })

  it('这份样式已经不在了就给空态，不画一份不存在的东西', () => {
    const wrapper = mountWizard('gone')

    expect(wrapper.findComponent(Twin2dStylePreview).exists()).toBe(false)
    expect(wrapper.find('[data-test="style-wizard-empty"]').exists()).toBe(true)
  })
})

describe('改动原样上抛', () => {
  it('六路改动一路不吞', () => {
    const wrapper = mountWizard()
    const next = normalizeTwin2dConfig({ styles: [] })

    pane(wrapper).vm.$emit('change', next)
    pane(wrapper).vm.$emit('merge', next, 'style:own:name')
    pane(wrapper).vm.$emit('endMerge')
    pane(wrapper).vm.$emit('pickPrim', 'p2')
    pane(wrapper).vm.$emit('copyPrim')
    pane(wrapper).vm.$emit('pastePrim')

    expect(wrapper.emitted('change')?.at(-1)).toEqual([next])
    expect(wrapper.emitted('merge')?.at(-1)).toEqual([next, 'style:own:name'])
    expect(wrapper.emitted('endMerge')).toHaveLength(1)
    expect(wrapper.emitted('pickPrim')?.at(-1)).toEqual(['p2'])
    expect(wrapper.emitted('copyPrim')).toHaveLength(1)
    expect(wrapper.emitted('pastePrim')).toHaveLength(1)
  })

  it('本面自己一个字都不落文档', () => {
    const wrapper = mountWizard()
    const before = JSON.stringify(CONFIG)

    pane(wrapper).vm.$emit('change', normalizeTwin2dConfig({ styles: [] }))

    expect(JSON.stringify(CONFIG)).toBe(before)
  })
})

describe('叠在抽屉之上', () => {
  it('layer 调到 confirm，否则会被样式库整个盖住', () => {
    expect(mountWizard().getComponent(DtModal).props('layer')).toBe('confirm')
  })

  it('按完成把开关抛回去', async () => {
    const wrapper = mountWizard()

    await wrapper.get('.dt-modal__foot button').trigger('click')

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
