/**
 * @fileoverview 契约：节点上的传感器药丸——**九档锚点一档不少**，且一枚药丸的两半
 * （追加图元与追加槽位）同进同出。
 *
 * ⚠ 九档是本轮的验收线：参考项目的编辑器只给四档（`AnchorId = 'l' | 'r' | 't' | 'b'`），
 * 手写 `'c'` 渲染得出来却在面板上选不到，于是下一次动这枚药丸就把它丢了。下面按
 * `TWIN_2D_ANCHORS` 逐档点一遍、再逐档回显一遍，少一格当场红。
 * ⚠ 只加图元不加槽位，墙上永远是占位符；只删槽位不删图元，那枚药丸再也接不到值。
 * 两种都零报错，所以增删两半必须在同一次写入里。
 */
import {
  TWIN_2D_ANCHORS,
  TWIN_2D_SENSOR_DEFAULT_AT,
  TWIN_2D_SENSOR_DEFS,
  twin2dSensorPill,
  twin2dSensorSlot,
} from '@dt/twin2d'
import type {
  Twin2dAnchor9,
  Twin2dPlacement,
  Twin2dPrim,
  Twin2dSlot,
} from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NodeSensorList from '@/pages/Twin2dEditor/components/inspector/NodeSensorList.vue'

/** 温度那一种；用它当样本，四种走的是同一条路径。 */
const TT = TWIN_2D_SENSOR_DEFS[0]
/** 流量那一种；验「换一种不串味」。 */
const FT = TWIN_2D_SENSOR_DEFS[1]

/**
 * 造一枚落在某处的温度药丸。
 * @param at 落点
 */
function ttPill(at: Twin2dPlacement = TWIN_2D_SENSOR_DEFAULT_AT): Twin2dPrim {
  return twin2dSensorPill(TT, at, 'sensor-tt')
}

/**
 * 九档锚点里的一档。
 * @param anchor 锚点
 */
function anchorAt(anchor: Twin2dAnchor9): Twin2dPlacement {
  return { kind: 'anchor', anchor, dx: 0, dy: 0 }
}

function mountList(
  layers: readonly Twin2dPrim[] = [],
  slots: readonly Twin2dSlot[] = [],
) {
  return mount(NodeSensorList, { props: { layers, slots } })
}

type Wrapper = ReturnType<typeof mountList>

/** 最后一次写回的三样：追加图元、追加槽位、合并键。 */
function lastUpdate(
  wrapper: Wrapper,
): [readonly Twin2dPrim[], readonly Twin2dSlot[], string | null] {
  const events = wrapper.emitted('update')
  if (!events?.length) throw new Error('没有写回传感器')
  const last = events[events.length - 1]
  return [
    last?.[0] as readonly Twin2dPrim[],
    last?.[1] as readonly Twin2dSlot[],
    last?.[2] as string | null,
  ]
}

/** 写回之后那枚温度药丸的落点。 */
function movedAt(wrapper: Wrapper): Twin2dPlacement {
  const [layers] = lastUpdate(wrapper)
  const pill = layers.find((prim) => prim.id === 'sensor-tt-pill')
  if (pill === undefined) throw new Error('写回的图元里没有温度药丸')
  return pill.at
}

describe('九档锚点', () => {
  it('九档一档不少，点哪一档就写哪一档', async () => {
    for (const anchor of TWIN_2D_ANCHORS) {
      const wrapper = mountList([ttPill(anchorAt('t'))], [twin2dSensorSlot(TT)])

      await wrapper
        .find(`[data-test="placement-anchor-${anchor}"]`)
        .trigger('click')

      expect(movedAt(wrapper)).toEqual(anchorAt(anchor))
    }
  })

  it('九档各自回显成按下去的那一格', () => {
    for (const anchor of TWIN_2D_ANCHORS) {
      const wrapper = mountList([ttPill(anchorAt(anchor))])

      const pressed = wrapper
        .findAll('[role="group"] button')
        .filter((button) => button.attributes('aria-pressed') === 'true')

      expect(pressed).toHaveLength(1)
      expect(
        wrapper
          .find(`[data-test="placement-anchor-${anchor}"]`)
          .attributes('aria-pressed'),
      ).toBe('true')
    }
  })

  it('挪落点走合并撤销，键钉在这一种传感器上', async () => {
    const wrapper = mountList([ttPill()])

    await wrapper.find('[data-test="placement-anchor-br"]').trigger('click')

    expect(lastUpdate(wrapper)[2]).toBe('sensor-at:TT')
  })

  it('挪一枚不动另一枚', async () => {
    const wrapper = mountList([
      ttPill(anchorAt('t')),
      twin2dSensorPill(FT, anchorAt('b'), 'sensor-ft'),
    ])

    await wrapper.find('[data-test="placement-anchor-l"]').trigger('click')

    const [layers] = lastUpdate(wrapper)
    expect(layers.find((prim) => prim.id === 'sensor-ft-pill')?.at).toEqual(
      anchorAt('b'),
    )
  })
})

describe('两半同进同出', () => {
  it('四种预置传感器各摆一行', () => {
    const wrapper = mountList()

    for (const def of TWIN_2D_SENSOR_DEFS) {
      expect(wrapper.find(`[data-test="sensor-row-${def.id}"]`).exists()).toBe(
        true,
      )
    }
  })

  it('勾上就同时落一枚药丸与一条读数槽位', async () => {
    const wrapper = mountList()

    await wrapper.find('[data-test="sensor-toggle-TT"] input').setValue(true)

    const [layers, slots, mergeKey] = lastUpdate(wrapper)
    expect(layers.map((prim) => prim.id)).toEqual(['sensor-tt-pill'])
    expect(slots.map((slot) => slot.key)).toEqual([TT.slotKey])
    expect(mergeKey).toBeNull()
  })

  it('槽键已经在册就不再加一条', async () => {
    const wrapper = mountList([], [twin2dSensorSlot(TT)])

    await wrapper.find('[data-test="sensor-toggle-TT"] input').setValue(true)

    expect(lastUpdate(wrapper)[1]).toHaveLength(1)
  })

  it('取消勾选就把药丸与读数槽位一起撤掉', async () => {
    const wrapper = mountList(
      [ttPill(), twin2dSensorPill(FT, anchorAt('b'), 'sensor-ft')],
      [twin2dSensorSlot(TT), twin2dSensorSlot(FT)],
    )

    await wrapper.find('[data-test="sensor-toggle-TT"] input').setValue(false)

    const [layers, slots] = lastUpdate(wrapper)
    expect(layers.map((prim) => prim.id)).toEqual(['sensor-ft-pill'])
    expect(slots.map((slot) => slot.key)).toEqual([FT.slotKey])
  })

  it('没装上的那一种不摆落点面', () => {
    const wrapper = mountList()

    expect(wrapper.find('[data-test="sensor-at-TT"]').exists()).toBe(false)
  })

  it('装上的那一种回显成勾上', () => {
    const wrapper = mountList([ttPill()])

    const box = wrapper.find<HTMLInputElement>(
      '[data-test="sensor-toggle-TT"] input',
    )
    expect(box.element.checked).toBe(true)
  })

  it('焦点离开就断段', async () => {
    const wrapper = mountList([ttPill()])

    await wrapper.find('[data-test="sensor-row-TT"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
