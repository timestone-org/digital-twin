/**
 * @fileoverview 契约：距离字段的「量当前距离」按**当前参考系**取数并整份写回，
 * 量不出时说清是哪一档量不出，绝不悄悄填一个数。
 *
 * ⚠ 填错参考系的后果是静默的：同一个位置在三种参考系下是三个数，
 * 拿轨道距离去填部件中心那一档，阈值看起来配好了却在别的位置生效。
 */
import type { TwinDistanceRule } from '@dt/twin-config'
import { DtButton, DtSelect, useToast } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DistanceField from '@/pages/TwinEditor/components/fields/DistanceField.vue'
import {
  provideTwinMeasure,
  type TwinMeasureDistance,
} from '@/pages/TwinEditor/scripts/twinMeasure'

const LABEL = '远于此距离隐藏'
const RULE: TwinDistanceRule = { ref: 'orbit', value: 10 }

/**
 * 挂一个带测距替身的宿主：字段自己拿不到视口，只认 provide 进来的那一个。
 * @param measure 测距替身
 * @param modelValue 初始阈值；null = 整条没配
 */
function mountField(
  measure: TwinMeasureDistance,
  modelValue: TwinDistanceRule | null = RULE,
) {
  const writes: (TwinDistanceRule | null)[] = []
  const host = defineComponent({
    setup() {
      provideTwinMeasure(measure)
      return () =>
        h(DistanceField, {
          modelValue,
          label: LABEL,
          'onUpdate:modelValue': (next: TwinDistanceRule | null) =>
            writes.push(next),
        })
    },
  })
  return { wrapper: mount(host), writes }
}

/** 尺子键；它是这一行里唯一的按钮。 */
function ruler(
  found: readonly { trigger: (event: string) => Promise<void> }[],
) {
  const button = found[0]
  if (button === undefined) throw new Error('没有量当前距离的按钮')
  return button
}

beforeEach(() => {
  useToast().clear()
})

describe('量当前距离', () => {
  it('把量出来的数填进阈值，参考系原样留着', async () => {
    const { wrapper, writes } = mountField(() => 42.5)

    await ruler(wrapper.findAllComponents(DtButton)).trigger('click')

    expect(writes).toEqual([{ ref: 'orbit', value: 42.5 }])
  })

  it('量的是当前那个参考系，不是恒定的某一档', async () => {
    const measure = vi.fn<TwinMeasureDistance>(() => 7)
    const { wrapper } = mountField(measure, { ref: 'part-center', value: 3 })

    await ruler(wrapper.findAllComponents(DtButton)).trigger('click')

    expect(measure).toHaveBeenCalledWith('part-center')
  })

  // 读出来 12.35 却填进去 12.345678 的话，界面与配置里不是一个数
  it('小数位与读数同一套口径，不把一串长小数塞进表单', async () => {
    const { wrapper, writes } = mountField(() => 12.345678)

    await ruler(wrapper.findAllComponents(DtButton)).trigger('click')

    expect(writes).toEqual([{ ref: 'orbit', value: 12.35 }])
  })

  it('量不出时一个字都不写回，并说清是哪一档量不出', async () => {
    const { wrapper, writes } = mountField(() => null, {
      ref: 'part-center',
      value: 3,
    })

    await ruler(wrapper.findAllComponents(DtButton)).trigger('click')

    expect(writes).toEqual([])
    const messages = useToast().toasts.value.map((item) => item.message)
    expect(messages.join(' ')).toContain('选中的不是部件')
  })

  // 没人 provide 测距时（挂载测试、将来别的宿主）按钮照样在，只是量不出
  it('没有测距来源时按钮不写回，也不炸', async () => {
    const wrapper = mount(DistanceField, {
      props: { modelValue: RULE, label: LABEL },
    })

    await ruler(wrapper.findAllComponents(DtButton)).trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('整条没配时不摆尺子——没有阈值可填', () => {
    const { wrapper } = mountField(() => 42.5, null)

    expect(wrapper.findAllComponents(DtButton)).toHaveLength(0)
    expect(wrapper.findAllComponents(DtSelect)).toHaveLength(0)
  })
})
