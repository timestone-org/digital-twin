<script setup lang="ts">
/**
 * @fileoverview 原件预览的画布：按画法把字节交给对应的那一个渲染件。
 *
 * ⚠ 重的那三种（PDF / Word / 工作簿）都是**异步组件**：它们各自静态依赖一个
 * 几百 KB 的解析库，同步引进来会让知识库页每次打开都先下一遍，
 * 而多数时候用户根本不点预览。轻的那三种直接引，拆出去反而多一次往返。
 *
 * ⚠ 这一层刻意只做分派，不碰取数：每一种画法的失败都长得不一样（PDF 是结构
 * 坏了、工作簿是没有工作表），由各自的件自己说。
 */
import { DtEmpty, DtSpinner } from '@dt/ui'
import { defineAsyncComponent } from 'vue'

import type { PreviewKind } from '../scripts/documentPreview'
import DocumentPreviewHtml from './DocumentPreviewHtml.vue'
import DocumentPreviewImage from './DocumentPreviewImage.vue'
import DocumentPreviewText from './DocumentPreviewText.vue'

const DocumentPreviewPdf = defineAsyncComponent({
  loader: () => import('./DocumentPreviewPdf.vue'),
  loadingComponent: DtSpinner,
})
const DocumentPreviewDocx = defineAsyncComponent({
  loader: () => import('./DocumentPreviewDocx.vue'),
  loadingComponent: DtSpinner,
})
const DocumentPreviewSheet = defineAsyncComponent({
  loader: () => import('./DocumentPreviewSheet.vue'),
  loadingComponent: DtSpinner,
})

const props = defineProps<{
  /** 原件的字节。 */
  blob: Blob
  /** 文本族的画法用它；其余画法是空串。 */
  text: string
  kind: PreviewKind
  /** 原件的文件名，给图片的 alt 与 iframe 的标题用。 */
  name: string
}>()
</script>

<template>
  <div class="doc-stage">
    <DocumentPreviewPdf v-if="props.kind === 'pdf'" :blob="props.blob" />
    <DocumentPreviewDocx v-else-if="props.kind === 'docx'" :blob="props.blob" />
    <DocumentPreviewSheet
      v-else-if="props.kind === 'sheet'"
      :blob="props.blob"
    />
    <DocumentPreviewImage
      v-else-if="props.kind === 'image'"
      :blob="props.blob"
      :name="props.name"
    />
    <DocumentPreviewHtml
      v-else-if="props.kind === 'html'"
      :text="props.text"
      :name="props.name"
    />
    <DocumentPreviewText
      v-else-if="props.kind === 'markdown' || props.kind === 'text'"
      :text="props.text"
      :kind="props.kind"
    />
    <DtEmpty
      v-else
      icon="paperclip"
      title="这个格式没法在页面里预览"
      hint="下载原件后用对应的软件打开。它照常会被解析、切块、进检索。"
    />
  </div>
</template>

<style scoped lang="scss">
.doc-stage {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}
</style>
