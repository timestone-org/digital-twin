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
import type {
  ReportBody,
  ReportDocument,
  ReportPage,
  ReportMetric,
} from '@dt/contracts'
import { UMO_ASSETS_DIR } from '../../../../../umoAssets.shared'
import { createBusinessExtensions } from '../scripts/businessNodes'
import { reportTypography } from '../scripts/reportTypography'
import {
  createPreviewStore,
  previewSignatures,
  type DocumentPreview,
} from '../scripts/documentPreview'
import { paperFontStack, REPORT_DEFAULT_PAGE } from '../scripts/paperFont'
import NodeDialog from './NodeDialog.vue'
import { documentFrom } from '../../scripts/reportDocument'

const props = withDefaults(
  defineProps<{
    modelValue: ReportDocument
    disabled?: boolean
    page?: ReportPage
    metrics?: ReportMetric[]
    title?: string
    saveDocument?: () => Promise<boolean>
    documentPreview?: DocumentPreview | null
    apiSources?: NonNullable<ReportBody['api_sources']>
  }>(),
  {
    disabled: false,
    page: () => ({}),
    title: '',
    metrics: () => [],
    documentPreview: null,
    apiSources: () => [],
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: ReportDocument]
  'update:page': [value: ReportPage]
}>()

const editorRef = ref<UmoEditorInstance | null>(null)
const previewStore = createPreviewStore()
const tiptap = shallowRef<TiptapEditor | null>(null)
const editingNode = ref<ReportDocument | null>(null)
const isEditingNode = ref(false)
let applyNode: ((attrs: Record<string, unknown>) => boolean) | null = null
function editNode(event: Event): void {
  if (props.disabled || !(event instanceof CustomEvent)) return
  const detail: unknown = event.detail
  if (!isRecord(detail) || typeof detail['apply'] !== 'function') return
  editingNode.value = documentFrom(detail['node'])
  applyNode = detail['apply'] as (attrs: Record<string, unknown>) => boolean
  isEditingNode.value = true
}
function updateNode(node: ReportDocument): void {
  if (!props.disabled) applyNode?.(node.attrs ?? {})
}
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
  // ⚠ Umo 不接旋转角；该字段只供服务端 Word 生成，回写时必须保留。
  const previous = (pendingPage ?? props.page).watermark
  patchPage({
    watermark: {
      ...(previous ?? {}),
      text,
      ...(typeof fontSize === 'number'
        ? { font_size_pt: fontSize * 0.75 }
        : {}),
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
    extensions: [...createBusinessExtensions(previewStore), reportTypography],
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
  previewStore.refresh()
}

watch(
  () => props.documentPreview,
  (value) => previewStore.set(value),
  { immediate: true },
)

/** 编辑器当前正文的业务节点指纹，试算发起时记下。 */
function signatures(): Record<string, string> {
  const json = editorRef.value?.getJSON()
  return json ? previewSignatures(documentFrom(json)) : {}
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
  '--report-body-font': paperFontStack(
    props.page.font_family ?? REPORT_DEFAULT_PAGE.fontFamily,
  ),
  '--report-body-size': `${props.page.font_size_pt ?? REPORT_DEFAULT_PAGE.fontSizePt}pt`,
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

function insert(node: ReportDocument): boolean {
  const current = tiptap.value
  if (current === null) return false
  return current.chain().focus().insertContent(editorDocument(node)).run()
}

defineExpose({ insert, signatures })
</script>

<template>
  <div class="umo-dt-theme" :style="paperStyle" @report-node-edit="editNode">
    <NodeDialog
      v-model="isEditingNode"
      :node="editingNode"
      :metrics="props.metrics"
      :api-sources="props.apiSources"
      @insert="updateNode"
    />
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
  --umo-font-family: var(--font-sans);
  --td-font-family: var(--font-sans);
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
  line-height: 1.65;
}

/* 以下数值与 services/typography.py、table_layout.py 逐项对应。 */
.umo-dt-theme .umo-editor-content .umo-editor > * + *:not(.umo-floating-node) {
  margin-top: 6pt;
}

.umo-dt-theme .umo-editor-content :is(h1, h2, h3, h4, h5, h6) {
  color: var(--fx-const-ink);
  font-weight: 700;
  line-height: 1.4;
}

.umo-dt-theme .umo-editor-content .umo-editor > :is(h1, h2) {
  margin-top: 16pt;
}

.umo-dt-theme .umo-editor-content .umo-editor > :is(h3, h4, h5, h6) {
  margin-top: 10pt;
}

.umo-dt-theme .umo-editor-content h1 {
  font-size: 18pt;
}

.umo-dt-theme .umo-editor-content h2 {
  font-size: 15pt;
}

.umo-dt-theme .umo-editor-content h3 {
  font-size: 13pt;
}

.umo-dt-theme .umo-editor-content h4 {
  font-size: 12pt;
}

.umo-dt-theme .umo-editor-content :is(h5, h6) {
  font-size: 11pt;
}

/* Word 把正文第一段一级标题设为「标题」样式：22pt 居中。 */
.umo-dt-theme .umo-editor-content .umo-editor > h1:first-child {
  margin-top: 0;
  margin-bottom: 8pt;
  font-size: 22pt;
  text-align: center;
}

.umo-dt-theme .umo-status-bar {
  height: auto;
  min-height: 30px;
  flex-shrink: 0;
  flex-wrap: wrap;
  row-gap: 4px;
}

.umo-dt-theme .umo-status-bar-left,
.umo-dt-theme .umo-status-bar-right {
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
}
</style>

<style lang="scss">
.umo-dt-theme .report-data-node {
  display: inline-block;
  max-width: 100%;
  padding: 0.15em 0.55em;
  margin: 0.15em;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  background: var(--surface-panel);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 0.9em;
  cursor: pointer;
  white-space: normal;
  overflow-wrap: anywhere;
  &[data-report-node='condText'] {
    border-style: dashed;
  }
  &.report-data-block {
    display: block;
    padding: 1.25em;
    margin: 0.75em 0;
    border-left-width: 4px;
  }
  &[data-report-node='dsTable'] {
    border-style: double;
  }
  &.report-data-node--value {
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    background: transparent;
  }
  &.report-data-node--value:not(.report-data-block) {
    padding: 0;
    margin: 0;
    border: 0;
    border-bottom: 1px dotted var(--accent-primary);
    border-radius: 0;
  }
  &.report-data-block.report-data-node--value {
    padding: 0;
    border: 0;
    border-radius: 0;
  }
  &:hover,
  &:focus-visible,
  &.ProseMirror-selectednode {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }
  &:not(.report-data-node--value):is(
      :hover,
      :focus-visible,
      .ProseMirror-selectednode
    ) {
    background: var(--surface-raised);
  }
}

.umo-dt-theme .report-node-caption {
  font-size: 10.5pt;
  font-weight: 700;
  line-height: 1.4;
  margin-bottom: 6pt;
  &:empty {
    display: none;
  }
}

.umo-dt-theme .report-paper-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 10.5pt;
  line-height: 15pt;
  th,
  td {
    padding: 2pt 5pt;
    border: 0.5pt solid #d9d9d9;
    vertical-align: middle;
    overflow-wrap: anywhere;
  }
  th {
    background: #e8eef4;
    font-weight: 700;
    text-align: center;
  }
  tbody tr:nth-child(even) td {
    background: #f7f9fb;
  }
  td.is-number {
    text-align: right;
  }
}
</style>
