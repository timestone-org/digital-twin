<script setup lang="ts">
/** @fileoverview Umo Editor 报告正文壳，保留结构化业务节点与页面设置。 */
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { UmoEditor } from '@umoteam/editor'
import type {
  UmoCreatedPayload,
  UmoEditorInstance,
  UmoEditorOptions,
} from '@umoteam/editor'
import type { Editor as TiptapEditor } from '@tiptap/core'
import '@umoteam/editor/style'
import type { ReportDocument, ReportPage } from '@dt/contracts'
import { UMO_ASSETS_DIR } from '../../../../../umoAssets.shared'
import { businessExtensions } from '../scripts/businessNodes'
import { documentFrom } from '../../scripts/reportDocument'

const props = withDefaults(
  defineProps<{
    modelValue: ReportDocument
    disabled?: boolean
    page?: ReportPage
    title?: string
    saveDocument?: () => Promise<boolean>
  }>(),
  { disabled: false, page: () => ({}), title: '' },
)

const emit = defineEmits<{
  'update:modelValue': [value: ReportDocument]
  'update:page': [value: ReportPage]
}>()

const editorRef = ref<UmoEditorInstance | null>(null)
const tiptap = shallowRef<TiptapEditor | null>(null)
let emitted = ''
let pendingPage: ReportPage | null = null

const DEFAULT_MARGIN_CM = { top: 2.54, bottom: 2.54, left: 3.18, right: 3.18 }
const DEFAULT_WATERMARK = {
  alpha: 0.2,
  fontFamily: 'SimSun',
  fontSize: 16,
  fontWeight: 'normal',
  text: '',
  type: 'compact',
}
const PAPER_INK_VARIABLE = '--fx-const-ink'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function editorDocument(node: ReportDocument): Record<string, unknown> {
  return {
    type: node.type,
    ...(node.text !== null && node.text !== undefined
      ? { text: node.text }
      : {}),
    ...(node.attrs ? { attrs: node.attrs } : {}),
    ...(node.marks ? { marks: node.marks.map(editorDocument) } : {}),
    ...(node.content ? { content: node.content.map(editorDocument) } : {}),
  }
}

function patchPage(patch: Partial<ReportPage>): void {
  const base = pendingPage ?? props.page
  const next = { ...base, ...patch }
  if (JSON.stringify(next) === JSON.stringify(base)) return
  pendingPage = next
  emit('update:page', next)
}

watch(
  () => props.page,
  () => {
    pendingPage = null
  },
)

function changedValue(payload: unknown, key: string): unknown {
  return isRecord(payload) ? payload[key] : undefined
}

function onPageSize(payload: unknown): void {
  const size = changedValue(payload, 'pageSize')
  if (!isRecord(size)) return
  const width = size['width']
  const height = size['height']
  if (typeof width !== 'number' || typeof height !== 'number') return
  patchPage({ size: 'custom', width_cm: width, height_cm: height })
}

function onPageOrientation(payload: unknown): void {
  const orientation = changedValue(payload, 'pageOrientation')
  if (orientation === 'portrait' || orientation === 'landscape')
    patchPage({ orientation })
}

function onPageMargin(payload: unknown): void {
  const margin = changedValue(payload, 'pageMargin')
  if (!isRecord(margin)) return
  const { top, bottom, left, right } = margin
  if (![top, bottom, left, right].every((value) => typeof value === 'number'))
    return
  patchPage({
    margins_cm: {
      top: typeof top === 'number' ? top : DEFAULT_MARGIN_CM.top,
      bottom: typeof bottom === 'number' ? bottom : DEFAULT_MARGIN_CM.bottom,
      left: typeof left === 'number' ? left : DEFAULT_MARGIN_CM.left,
      right: typeof right === 'number' ? right : DEFAULT_MARGIN_CM.right,
    },
  })
}

function onPageWatermark(payload: unknown): void {
  const watermark = changedValue(payload, 'pageWatermark')
  if (!isRecord(watermark)) return
  const text =
    typeof watermark['text'] === 'string' ? watermark['text'].trim() : ''
  if (!text) {
    patchPage({ watermark: null })
    return
  }
  const fontSize = watermark['fontSize']
  const rotation = watermark['rotate']
  patchPage({
    watermark: {
      text,
      ...(typeof fontSize === 'number'
        ? { font_size_pt: fontSize * 0.75 }
        : {}),
      ...(typeof rotation === 'number' ? { rotation } : {}),
    },
  })
}

function umoWatermark(): Record<string, unknown> {
  const watermark = props.page.watermark
  return {
    ...DEFAULT_WATERMARK,
    fontColor:
      getComputedStyle(document.documentElement)
        .getPropertyValue(PAPER_INK_VARIABLE)
        .trim() || `var(${PAPER_INK_VARIABLE})`,
    ...(watermark?.text ? { text: watermark.text } : {}),
    ...(watermark?.font_size_pt
      ? { fontSize: Math.round((watermark.font_size_pt / 0.75) * 100) / 100 }
      : {}),
    ...(watermark?.rotation !== undefined
      ? { rotate: watermark.rotation }
      : {}),
  }
}

function initialOptions(): UmoEditorOptions {
  return {
    cdnUrl: `${import.meta.env.BASE_URL}${UMO_ASSETS_DIR}`.replace(/\/+$/, ''),
    disableExtensions: ['share', 'exportPDF'],
    document: {
      autoSave: { enabled: false },
      content: editorDocument(props.modelValue),
      placeholder: '在这里编写报告正文；指标、条件文本、图表和表格从右侧插入',
      readOnly: props.disabled,
      title: props.title,
    },
    extensions: businessExtensions,
    locale: 'zh-CN',
    onSave: async () => {
      if (!props.saveDocument) {
        return { status: 'error', message: '保存动作未连接', showMessage: true }
      }
      return {
        status: (await props.saveDocument()) ? 'success' : 'error',
        showMessage: false,
      }
    },
    page: {
      defaultMargin: { ...DEFAULT_MARGIN_CM, ...props.page.margins_cm },
      defaultOrientation: props.page.orientation ?? 'portrait',
      watermark: umoWatermark(),
    },
    toolbar: { menus: ['base', 'insert', 'table', 'tools', 'page', 'view'] },
  }
}

const options = initialOptions()

function onCreated(payload: UmoCreatedPayload | undefined): void {
  tiptap.value = payload?.editor ?? null
}

function onChanged(): void {
  const json = editorRef.value?.getJSON()
  if (!json) return
  const document = documentFrom(json)
  emitted = JSON.stringify(document)
  emit('update:modelValue', document)
}

watch(
  () => props.modelValue,
  (document) => {
    if (!editorRef.value || JSON.stringify(document) === emitted) return
    editorRef.value.setContent(editorDocument(document))
  },
)

watch(
  () => props.disabled,
  (disabled) => editorRef.value?.setReadOnly?.(disabled),
)

const paperStyle = computed(() => ({
  '--report-body-font': props.page.font_family ?? 'var(--font-sans)',
  '--report-body-size': `${props.page.font_size_pt ?? 11}pt`,
}))

const THEME_ATTRIBUTE = 'theme-mode'
let previousTheme: string | null = null
let themeObserver: MutationObserver | null = null

function syncTheme(): void {
  const isDark = getComputedStyle(
    document.documentElement,
  ).colorScheme.includes('dark')
  document.documentElement.setAttribute(
    THEME_ATTRIBUTE,
    isDark ? 'dark' : 'light',
  )
}

onMounted(() => {
  previousTheme = document.documentElement.getAttribute(THEME_ATTRIBUTE)
  syncTheme()
  themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  if (previousTheme === null)
    document.documentElement.removeAttribute(THEME_ATTRIBUTE)
  else document.documentElement.setAttribute(THEME_ATTRIBUTE, previousTheme)
})

function insert(node: ReportDocument): void {
  tiptap.value?.chain().focus().insertContent(editorDocument(node)).run()
}

defineExpose({ insert })
</script>

<template>
  <div class="umo-dt-theme" :style="paperStyle">
    <UmoEditor
      ref="editorRef"
      v-bind="options"
      @created="onCreated"
      @changed="onChanged"
      @changed:page-size="onPageSize"
      @changed:page-orientation="onPageOrientation"
      @changed:page-margin="onPageMargin"
      @changed:page-watermark="onPageWatermark"
    />
  </div>
</template>

<style lang="scss">
.umo-dt-theme {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  --umo-container-background: var(--surface-base);
  --umo-color-white: var(--surface-panel);
  --umo-color-black: var(--text-primary);
  --umo-button-hover-background: var(--surface-raised);
  --umo-mask-color: var(--surface-overlay);
  --umo-shadow: var(--fx-shadow-menu);
  --umo-text-color: var(--text-primary);
  --umo-text-color-light: var(--text-secondary);
  --umo-text-color-disabled: var(--text-disabled);
  --umo-border-color: var(--border-default);
  --umo-border-color-light: var(--border-subtle);
  --umo-border-color-dark: var(--border-strong);
  --umo-primary-color: var(--accent-primary);
  --umo-error-color: var(--state-danger);
  --umo-warning-color: var(--state-warning);
  --umo-radius: var(--radius-sm);
  --umo-radius-medium: var(--radius-md);
  --umo-scrollbar-thumb-color: var(--border-default);
  --umo-scrollbar-thumb-hover-color: var(--border-hover);
}

.umo-dt-theme > * {
  height: 100%;
}

.umo-dt-theme .umo-page-content {
  color: var(--fx-const-ink);
  background: var(--fx-const-paper);
}

.umo-dt-theme .umo-editor-content .umo-editor {
  font-family: var(--report-body-font);
  font-size: var(--report-body-size);
}
</style>
