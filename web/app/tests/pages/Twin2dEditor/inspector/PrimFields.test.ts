/**
 * @fileoverview 契约：一枚图元按 kind 分派到四个分档面之一，身份与类型都不给改，
 * 取点请求原样转交。
 *
 * ⚠ 换 kind 等于把渲染分支整条换掉，摆一个「换类型」下拉会让人以为原地换过去还能
 * 留住已经配好的那些格子。
 * ⚠ id 是身份：节点级覆盖、变体补丁与 v-for 三处按它寻址，顺手换掉会让三处一起指空。
 */
import { TWIN_2D_PRIM_KINDS, normalizePrims } from '@dt/twin2d'
import type { Twin2dPrim, Twin2dPrimKind } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PrimFields from '@/pages/Twin2dEditor/components/inspector/PrimFields.vue'

function primOf(seed: Readonly<Record<string, unknown>>): Twin2dPrim {
  const one = normalizePrims([{ id: 'p1', ...seed }], 0)[0]
  if (one === undefined) throw new Error('样例图元没造出来')
  return one
}

function prim(kind: Twin2dPrimKind): Twin2dPrim {
  return primOf({
    kind,
    ...(kind === 'vec' ? { shape: { kind: 'rect' } } : {}),
  })
}

function mountFields(kind: Twin2dPrimKind = 'box', canPick = false) {
  return mount(PrimFields, { props: { modelValue: prim(kind), canPick } })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): Twin2dPrim {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回图元')
  return events[events.length - 1]?.[0] as Twin2dPrim
}

describe('分派', () => {
  it('四档各画各的面', () => {
    for (const kind of TWIN_2D_PRIM_KINDS) {
      const wrapper = mountFields(kind)

      expect(
        wrapper.find('[data-test="prim-fields"]').attributes('data-kind'),
        kind,
      ).toBe(kind)
    }
  })

  it('盒那一档摆的是盒自己的格子', () => {
    const wrapper = mountFields('box')

    expect(wrapper.find('[data-test="box-clip"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="txt-nowrap"]').exists()).toBe(false)
  })

  it('矢量那一档摆的是矢量自己的格子', () => {
    const wrapper = mountFields('vec')

    expect(wrapper.find('[data-test="vec-stretch"]').exists()).toBe(true)
  })

  it('图标那一档摆的是图标自己的格子', () => {
    const wrapper = mountFields('ico')

    expect(wrapper.find('[data-test="ico-kind"]').exists()).toBe(true)
  })

  it('文本那一档摆的是文本自己的格子', () => {
    const wrapper = mountFields('txt')

    expect(wrapper.find('[data-test="txt-nowrap"]').exists()).toBe(true)
  })

  it('四档都摆得出基类那一段', () => {
    for (const kind of TWIN_2D_PRIM_KINDS) {
      const wrapper = mountFields(kind)

      expect(wrapper.find('[data-test="base-z"]').exists(), kind).toBe(true)
    }
  })
})

describe('身份', () => {
  it('id 与类型只显示不给改', () => {
    const wrapper = mountFields('box')

    expect(wrapper.find('[data-test="prim-id"]').text()).toContain('p1')
    expect(wrapper.find('[data-test="prim-kind-select"]').exists()).toBe(false)
  })

  it('改一格之后 id 与 kind 原样带回', async () => {
    const wrapper = mountFields('txt')

    await wrapper.find('[data-test="base-z"]').setValue('3')
    const next = lastWrite(wrapper)

    expect(next.id).toBe('p1')
    expect(next.kind).toBe('txt')
  })
})

describe('取点', () => {
  it('接得住时把请求转交上去', async () => {
    const poly = primOf({
      kind: 'vec',
      shape: {
        kind: 'poly',
        points: [
          [0, 0],
          [1, 1],
        ],
      },
    })
    const wrapper = mount(PrimFields, {
      props: { modelValue: poly, canPick: true },
    })

    await wrapper.find('[data-test="geometry-pick"]').trigger('click')

    expect(wrapper.emitted('pick')?.[0]).toEqual(['poly'])
  })

  it('结束取点的请求也转交上去', async () => {
    const poly = primOf({
      kind: 'vec',
      shape: {
        kind: 'poly',
        points: [
          [0, 0],
          [1, 1],
        ],
      },
    })
    const wrapper = mount(PrimFields, {
      props: { modelValue: poly, canPick: true, picked: [[0, 0]] },
    })

    await wrapper.find('[data-test="geometry-pick-end"]').trigger('click')

    expect(wrapper.emitted('pickEnd')).toHaveLength(1)
  })

  // ⚠ 没人接时那个键不摆
  it('接不住时不摆取点键', () => {
    expect(
      mountFields('vec').find('[data-test="geometry-pick"]').exists(),
    ).toBe(false)
  })
})

describe('合并撤销的出口', () => {
  it('四档的 blur 都原样转上去', async () => {
    for (const kind of TWIN_2D_PRIM_KINDS) {
      const wrapper = mountFields(kind)

      await wrapper.find('[data-test="base-z"]').trigger('focusout')

      expect((wrapper.emitted('blur') ?? []).length, kind).toBeGreaterThan(0)
    }
  })

  it('四档改一格都往上抛整枚图元', async () => {
    for (const kind of TWIN_2D_PRIM_KINDS) {
      const wrapper = mountFields(kind)

      await wrapper.find('[data-test="base-z"]').setValue('3')

      expect(lastWrite(wrapper).z, kind).toBe(3)
    }
  })
})
