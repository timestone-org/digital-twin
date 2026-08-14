/**
 * @fileoverview 锁住编辑器里那些「写错了两道闸都放行」的名字：
 * 配置控件的分发表逐档铺满、控件的 prop 与事件名一致、模块清单的图标名都登记过。
 *
 * ⚠ 模板里的 prop / 插槽 / 注册名写错，typecheck 与 lint **双双放行**：
 * 多出来的 prop Vue 直接忽略，缺掉的那个控件静静渲染成空白。这个文件是它们
 * 唯一的防线。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ConfigField } from '@dt/contracts'
import { CONFIG_FIELD_TYPES } from '@dt/contracts'
import {
  __resetConfigControls,
  getConfigControl,
  listModules,
  missingConfigControls,
  registerBuiltinModules,
} from '@dt/modules'
import { isIconName } from '@dt/ui'

import { installConfigControls } from '@/features/dashboard/configControls'
import ConfigFieldControl from '@/features/dashboard/controls/ConfigFieldControl.vue'

registerBuiltinModules()

/** 每一档控件都能收到统一契约里那组 props 的最小字段。 */
function fieldOf(type: ConfigField['type']): ConfigField {
  return { key: 'demo', label: '演示', type }
}

describe('配置控件的分发表', () => {
  it('闭合联合逐档铺满，一个不缺', () => {
    __resetConfigControls()
    installConfigControls()

    expect([...missingConfigControls()]).toEqual([])
  })

  it('每一档取出来的都是组件而不是 undefined', () => {
    __resetConfigControls()
    installConfigControls()

    for (const type of CONFIG_FIELD_TYPES) {
      expect(getConfigControl(type)).toBeDefined()
    }
  })

  it('重复登记是幂等的', () => {
    __resetConfigControls()
    installConfigControls()
    installConfigControls()

    expect([...missingConfigControls()]).toEqual([])
  })
})

describe('控件的 prop 与事件名', () => {
  it('每一档都认得 field / value 两个 prop，且抛 update 事件', async () => {
    __resetConfigControls()
    installConfigControls()

    for (const type of CONFIG_FIELD_TYPES) {
      const wrapper = mount(ConfigFieldControl, {
        props: { field: fieldOf(type), value: undefined, depth: 0 },
      })
      await wrapper.vm.$nextTick()

      // 名字写错时这里会渲染成「还没登记」的告警而不是控件
      expect(wrapper.text()).not.toContain('还没登记')
      wrapper.unmount()
    }
  })

  it('没登记那一档时画出告警，而不是静默留白', () => {
    __resetConfigControls()

    const wrapper = mount(ConfigFieldControl, {
      props: { field: fieldOf('string'), value: undefined },
    })

    expect(wrapper.text()).toContain('还没登记')
    wrapper.unmount()
    installConfigControls()
  })
})

describe('模块清单的图标名', () => {
  it('每个内置模块的图标都在 DtIcon 注册表里', () => {
    const unregistered = listModules()
      .map((manifest) => manifest.icon)
      .filter((icon): icon is string => icon !== undefined)
      .filter((icon) => !isIconName(icon))

    expect(unregistered).toEqual([])
  })

  it('确实有内置模块被扫到，这条闸没有空转', () => {
    expect(listModules().length).toBeGreaterThan(0)
  })
})
