/**
 * @fileoverview 契约：打开那一刻算干净，改过才算脏，重开一次重新算。
 *
 * ⚠ 最要命的一条是**时序**：表单自己的回填 watcher 是默认的 'pre'，快照拍早一步
 * 拍到的是上一次的取值，于是弹窗一打开就被判成「脏的」——那时候误关保护会
 * 挡住每一次关闭，弹窗谁都关不掉。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, watch } from 'vue'

import { useFormDirty } from '@/composables/useFormDirty'

function must(read: (() => boolean) | null): () => boolean {
  if (read === null) throw new Error('composable 还没装起来')
  return read
}

/** 造一个「打开时回填、可改字段」的弹窗替身，回填走和真表单同一种 watcher。 */
function mountForm(initial = 'A') {
  const isOpen = ref(true)
  const filled = ref(initial)
  const field = ref('')
  let dirty: (() => boolean) | null = null

  const host = defineComponent({
    setup() {
      // 真表单就是这么回填的：watch(modelValue) 里把字段刷成目标值
      watch(
        isOpen,
        (open) => {
          if (open) field.value = filled.value
        },
        { immediate: true },
      )
      const form = useFormDirty(
        () => [field.value],
        () => isOpen.value,
      )
      dirty = () => form.isDirty.value
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { wrapper, isOpen, filled, field, isDirty: must(dirty) }
}

describe('打开那一刻', () => {
  it('回填进来的值不算改过', () => {
    const form = mountForm()

    expect(form.isDirty()).toBe(false)
  })

  it('⚠ 挂载时就开着的弹窗也要算干净：没有这一刀它一开就关不掉', () => {
    const form = mountForm('已有的名字')

    expect(form.isDirty()).toBe(false)
  })
})

describe('改过之后', () => {
  it('改一个字段就算脏', async () => {
    const form = mountForm()

    form.field.value = '改了'
    await nextTick()

    expect(form.isDirty()).toBe(true)
  })

  it('改回原样又算干净：撤销回去不该还拦着人', async () => {
    const form = mountForm('A')

    form.field.value = '改了'
    await nextTick()
    form.field.value = 'A'
    await nextTick()

    expect(form.isDirty()).toBe(false)
  })
})

describe('重开一次', () => {
  it('换一条记录再打开，按新记录重新算干净', async () => {
    const form = mountForm('第一条')

    form.field.value = '乱填的'
    await nextTick()
    form.isOpen.value = false
    await nextTick()
    form.filled.value = '第二条'
    form.isOpen.value = true
    await nextTick()

    expect(form.field.value).toBe('第二条')
    expect(form.isDirty()).toBe(false)
  })
})
