/** @fileoverview Umo Editor 壳的业务节点、正文回填与只读接线。 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { ReportDocument } from '@dt/contracts'
import type { PropType } from 'vue'

vi.mock('@umoteam/editor/style', () => ({ default: '' }))

const umo = vi.hoisted(() => ({
  emit: null as ((event: string, payload?: unknown) => void) | null,
}))

vi.mock('@umoteam/editor', async () => {
  const { defineComponent, h, onMounted, ref } = await import('vue')
  const UmoEditor = defineComponent({
    name: 'UmoEditorStub',
    props: {
      document: {
        type: Object as PropType<Record<string, unknown>>,
        default: () => ({}),
      },
      toolbar: { type: Object, default: () => ({}) },
      page: { type: Object, default: () => ({}) },
      disableExtensions: { type: Array, default: () => [] },
      extensions: { type: Array, default: () => [] },
      onSave: { type: Function, default: null },
    },
    emits: [
      'created',
      'changed',
      'changed:pageSize',
      'changed:pageOrientation',
      'changed:pageMargin',
      'changed:pageWatermark',
    ],
    setup(props, { emit, expose }) {
      const initialDocument = () => props.document['content']
      const initial = initialDocument()
      const isRecord = (value: unknown): value is Record<string, unknown> =>
        value !== null && typeof value === 'object' && !Array.isArray(value)
      const document = ref<Record<string, unknown>>(
        isRecord(initial) ? initial : { type: 'doc' },
      )
      let pending: Record<string, unknown> | null = null
      const chain = {
        focus: () => chain,
        insertContent: (node: Record<string, unknown>) => {
          pending = node
          return chain
        },
        run: () => {
          if (pending) {
            const content = Array.isArray(document.value['content'])
              ? document.value['content']
              : []
            document.value = {
              ...document.value,
              content: [...content, pending],
            }
            pending = null
            emit('changed')
          }
          return true
        },
      }
      expose({
        getJSON: () => document.value,
        setContent: (next: Record<string, unknown>) => {
          document.value = next
        },
        setReadOnly: () => undefined,
      })
      umo.emit = emit as (event: string, payload?: unknown) => void
      onMounted(() => emit('created', { editor: { chain: () => chain } }))
      return () =>
        h('div', { class: 'umo-stub' }, JSON.stringify(document.value))
    },
  })
  return { UmoEditor, default: UmoEditor }
})

const ReportEditor = (
  await import('@/pages/Reports/Editor/components/ReportEditor.vue')
).default

const blank: ReportDocument = { type: 'doc', content: [{ type: 'paragraph' }] }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isSaveHandler(value: unknown): value is () => Promise<unknown> {
  return typeof value === 'function'
}

describe('报告编辑器', () => {
  it('使用 Umo 并插入可保存的业务 AST', async () => {
    const wrapper = mount(ReportEditor, { props: { modelValue: blank } })
    await flushPromises()
    wrapper.vm.insert({
      type: 'metricRef',
      attrs: { expr: '{本期}', precision: 2 },
    })
    await flushPromises()
    expect(JSON.stringify(wrapper.emitted('update:modelValue'))).toContain(
      'metricRef',
    )
    expect(wrapper.text()).toContain('{本期}')
    const umo = wrapper.findComponent({ name: 'UmoEditorStub' })
    expect(umo.props('toolbar')).toEqual({
      menus: ['base', 'insert', 'table', 'tools', 'page', 'view'],
    })
    expect(umo.props('disableExtensions')).toEqual(['share', 'exportPDF'])
    wrapper.unmount()
  })

  it('只读状态与外部正文更新都传给 Umo', async () => {
    const wrapper = mount(ReportEditor, {
      props: { modelValue: blank, disabled: true },
    })
    await flushPromises()
    const documentOptions = record(
      wrapper.findComponent({ name: 'UmoEditorStub' }).props('document'),
    )
    expect(documentOptions['readOnly']).toBe(true)
    await wrapper.setProps({
      modelValue: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '已保存内容' }],
          },
        ],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('已保存内容')
    wrapper.unmount()
  })

  it('把 Umo 页面设置换算并合并到报告契约', async () => {
    const wrapper = mount(ReportEditor, {
      props: {
        modelValue: blank,
        page: {
          orientation: 'portrait',
          margins_cm: { top: 1, bottom: 2, left: 3, right: 4 },
          watermark: { text: '内部', font_size_pt: 12, rotation: -30 },
        },
      },
    })
    await flushPromises()
    expect(
      wrapper.findComponent({ name: 'UmoEditorStub' }).props('page'),
    ).toEqual(
      expect.objectContaining({
        defaultOrientation: 'portrait',
        defaultMargin: { top: 1, bottom: 2, left: 3, right: 4 },
      }),
    )
    umo.emit?.('changed:pageSize', { pageSize: { width: 29.7, height: 42 } })
    umo.emit?.('changed:pageOrientation', { pageOrientation: 'landscape' })
    umo.emit?.('changed:pageMargin', {
      pageMargin: { top: 2, bottom: 2, left: 2.5, right: 2.5 },
    })
    umo.emit?.('changed:pageWatermark', {
      pageWatermark: { text: '机密', fontSize: 20, rotate: -45 },
    })
    const updates = wrapper.emitted('update:page')
    expect(updates?.at(-1)?.[0]).toEqual({
      orientation: 'landscape',
      size: 'custom',
      width_cm: 29.7,
      height_cm: 42,
      margins_cm: { top: 2, bottom: 2, left: 2.5, right: 2.5 },
      watermark: { text: '机密', font_size_pt: 15, rotation: -45 },
    })
    wrapper.unmount()
  })

  it('编辑器内保存与页面保存共用同一回调', async () => {
    const saveDocument = vi.fn().mockResolvedValue(true)
    const wrapper = mount(ReportEditor, {
      props: { modelValue: blank, saveDocument },
    })
    await flushPromises()
    const onSave: unknown = wrapper
      .findComponent({ name: 'UmoEditorStub' })
      .props('onSave')
    expect(isSaveHandler(onSave)).toBe(true)
    if (!isSaveHandler(onSave)) return
    await expect(onSave()).resolves.toEqual({
      status: 'success',
      showMessage: false,
    })
    expect(saveDocument).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('水印颜色从固定纸张墨色 token 取值', async () => {
    document.documentElement.style.setProperty(
      '--fx-const-ink',
      'rgb(31 35 40)',
    )
    const wrapper = mount(ReportEditor, { props: { modelValue: blank } })
    await flushPromises()
    const page = record(
      wrapper.findComponent({ name: 'UmoEditorStub' }).props('page'),
    )
    const watermark = record(page['watermark'])
    expect(watermark['fontColor']).toBe('rgb(31 35 40)')
    wrapper.unmount()
    document.documentElement.style.removeProperty('--fx-const-ink')
  })
})
