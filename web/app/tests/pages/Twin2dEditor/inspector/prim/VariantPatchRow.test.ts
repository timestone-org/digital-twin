/**
 * @fileoverview 契约：一条图元覆盖编的是「盖过之后的样子」，改哪一格哪一格才进补丁；
 * 指空了的那一条当场标红。
 *
 * ⚠ 差按引用比：没碰过的键连引用都不换，所以只有真被改到的键会进补丁。
 * ⚠ 已经在补丁里的键即使被改回原值也留着——不然「改回去」与「不覆盖」在界面上分不出来。
 * ⚠ 指空的补丁永远不会生效，而界面上它看着与别的一模一样。
 */
import { normalizePrims } from '@dt/twin2d'
import type { Twin2dPrim, Twin2dPrimPatch } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import VariantPatchRow from '@/pages/Twin2dEditor/components/inspector/prim/VariantPatchRow.vue'

function boxPrim(over: Readonly<Record<string, unknown>> = {}): Twin2dPrim {
  const one = normalizePrims([{ id: 'frame', kind: 'box', ...over }], 0)[0]
  if (one === undefined) throw new Error('样例图元没造出来')
  return one
}

function mountRow(
  patch: Twin2dPrimPatch = {},
  base: Twin2dPrim | null = boxPrim(),
) {
  return mount(VariantPatchRow, { props: { primId: 'frame', base, patch } })
}

type Wrapper = ReturnType<typeof mountRow>

function lastWrite(wrapper: Wrapper): Twin2dPrimPatch {
  const events = wrapper.emitted('update')
  if (!events?.length) throw new Error('没有写回覆盖')
  return events[events.length - 1]?.[0] as Twin2dPrimPatch
}

describe('指空', () => {
  it('样式里没有这枚图元时当场标红', () => {
    const wrapper = mountRow({}, null)

    expect(wrapper.find('[data-test="vpatch-dangling-frame"]').exists()).toBe(
      true,
    )
  })

  it('指空时不摆图元那一面', () => {
    expect(mountRow({}, null).find('[data-test="prim-fields"]').exists()).toBe(
      false,
    )
  })

  it('指得到时不标红', () => {
    expect(
      mountRow().find('[data-test="vpatch-dangling-frame"]').exists(),
    ).toBe(false)
  })
})

describe('盖住了哪几格', () => {
  it('一格都没盖时给一句说明', () => {
    expect(mountRow().text()).toContain('还没盖住任何一格')
  })

  it('盖住的那几格逐格摆出来，写的是中文名', () => {
    const wrapper = mountRow({ hidden: true, opacity: 0.5 })

    expect(
      wrapper.find('[data-test="vpatch-clear-frame-hidden"]').exists(),
    ).toBe(true)
    expect(wrapper.text()).toContain('不透明度')
  })

  it('点一格就把那一格撤掉，别的留着', async () => {
    const wrapper = mountRow({ hidden: true, opacity: 0.5 })

    await wrapper
      .find('[data-test="vpatch-clear-frame-hidden"]')
      .trigger('click')

    expect(lastWrite(wrapper)).toEqual({ opacity: 0.5 })
  })

  it('整条撤掉走的是另一个出口', async () => {
    const wrapper = mountRow({ hidden: true })

    await wrapper.find('[data-test="vpatch-remove-frame"]').trigger('click')

    expect(wrapper.emitted('remove')).toHaveLength(1)
  })
})

describe('编的是盖过之后的样子', () => {
  it('图元那一面上是补丁盖过之后的取值', () => {
    const wrapper = mountRow({ z: 7 })
    const box = wrapper.find('[data-test="base-z"]').element as HTMLInputElement

    expect(box.value).toBe('7')
  })

  // ⚠ 只有真被改到的键进补丁
  it('改一格只把那一格写进补丁', async () => {
    const wrapper = mountRow()

    await wrapper.find('[data-test="base-z"]').setValue('9')

    expect(lastWrite(wrapper)).toEqual({ z: 9 })
  })

  it('已经盖住的那几格照旧留着', async () => {
    const wrapper = mountRow({ hidden: true })

    await wrapper.find('[data-test="base-opacity"]').setValue('0.4')

    expect(lastWrite(wrapper)).toEqual({ hidden: true, opacity: 0.4 })
  })

  it('身份与子树进不了补丁', async () => {
    const wrapper = mountRow(
      {},
      boxPrim({ children: [{ id: 'c1', kind: 'txt' }] }),
    )

    await wrapper.find('[data-test="base-z"]').setValue('2')
    const next = lastWrite(wrapper)

    expect('id' in next).toBe(false)
    expect('kind' in next).toBe(false)
    expect('children' in next).toBe(false)
  })

  it('盒自己的那几格也盖得住', async () => {
    const wrapper = mountRow()

    await wrapper.find('[data-test="box-clip"] input').setValue(true)

    expect(lastWrite(wrapper)).toEqual({ clip: true })
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出 blur', async () => {
    const wrapper = mountRow()

    await wrapper.find('[data-test="base-z"]').trigger('focusout')

    expect((wrapper.emitted('blur') ?? []).length).toBeGreaterThan(0)
  })
})
