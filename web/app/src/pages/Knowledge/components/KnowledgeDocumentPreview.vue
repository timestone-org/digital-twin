<script setup lang="ts">
/**
 * @fileoverview 原件预览弹窗：把一份文档的原件取回来，按格式画出来，并给下载。
 *
 * ⚠ 字节走**认人的接口**取回 Blob，不写进任何 `src`：浏览器给 `<img>`、
 * `<iframe>` 这类子资源请求带不上 `Authorization`，而知识库的原件不匿名可读。
 * 写进 src 的表现是一个空白框，且不报任何错。
 * ⚠ 也不发预签名 URL：那是一条「谁拿到谁能看」的链接，而库里可能有涉密图纸。
 *
 * ⚠ 快速连点两份文档会让先发的那次后返回：走统一的竞态防护，不手搓序号。
 * 关掉弹窗时要 `cancel()`——不作废的话，之后才返回的那一次照样会写进一个
 * 已经没人看的状态。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { DtButton, DtModal, DtNotice, DtSpinner } from '@dt/ui'

import { readDocumentRaw } from '@/api/knowledge'
import type { KnowledgeDocument } from '@/api/knowledge'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { downloadBytes } from '@/utils/downloadJson'
import { formatSize } from '@/utils/filesize'
import { previewKindOf } from '../scripts/documentPreview'
import DocumentPreviewStage from './DocumentPreviewStage.vue'

/** 要先解成文字再画的那几种画法。 */
const TEXTUAL = ['markdown', 'text', 'html']

const props = defineProps<{
  modelValue: boolean
  document: KnowledgeDocument | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

interface Loaded {
  blob: Blob
  /** 文本族画法的正文；其余画法是空串。 */
  text: string
}

const loaded = ref<Loaded | null>(null)
const failure = ref('')
const isLoading = ref(false)
const race = useRacedFetch()

const name = computed(() => props.document?.title ?? '')
const kind = computed(() => previewKindOf(name.value))
const subtitle = computed(() =>
  props.document === null ? '' : formatSize(props.document.sizeBytes),
)

function reset(): void {
  loaded.value = null
  failure.value = ''
  isLoading.value = false
}

/**
 * 取回字节；文本族顺手解成文字。
 * @param documentId 哪份文档
 * @param signal 中止信号
 */
async function fetched(
  documentId: string,
  signal: AbortSignal,
): Promise<Loaded> {
  const blob = await readDocumentRaw(documentId, signal)
  const text = TEXTUAL.includes(kind.value) ? await blob.text() : ''
  return { blob, text }
}

function open(documentId: string): void {
  reset()
  isLoading.value = true
  void race.run((signal) => fetched(documentId, signal), {
    ok: (got) => (loaded.value = got),
    // ⚠ 把后端那句话原样摆出来：它是写给最终用户的（「这份文档来自外部系统，
    // 没有可看的原件」），换成一句通用话，用户就看不出到底出了什么事
    fail: (caught) => (failure.value = messageOf(caught)),
    settled: () => (isLoading.value = false),
  })
}

function messageOf(caught: unknown): string {
  return caught instanceof Error && caught.message !== ''
    ? caught.message
    : '这份原件取不回来'
}

function save(): void {
  if (loaded.value === null) return
  downloadBytes(loaded.value.blob, name.value)
}

watch(
  () => [props.modelValue, props.document?.id ?? ''] as const,
  ([isOpen, documentId]) => {
    race.cancel()
    if (!isOpen || documentId === '') {
      reset()
      return
    }
    open(documentId)
  },
  { immediate: true },
)

onUnmounted(() => race.cancel())
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    :title="name"
    :description="subtitle"
    width="72rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="doc-preview">
      <DtSpinner v-if="isLoading" />
      <DtNotice v-else-if="failure !== ''" intent="danger">
        {{ failure }}
      </DtNotice>
      <DocumentPreviewStage
        v-else-if="loaded !== null"
        :blob="loaded.blob"
        :text="loaded.text"
        :kind="kind"
        :name="name"
      />
    </div>

    <template #footer>
      <DtButton
        variant="outline"
        icon="download"
        :disabled="loaded === null"
        @click="save"
      >
        下载原件
      </DtButton>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        关闭
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.doc-preview {
  display: flex;
  // ⚠ 给一个**定高**而不是让它跟着内容长：里面那几种画法都靠 `flex: 1` +
  // 自己滚，而滚动容器必须有确定的高度。跟着内容长的话 PDF 的懒渲染会
  // 一次把整本都画出来——它判「滚到跟前了没有」用的就是这个盒子
  height: min(70vh, 52rem);
  min-height: 18rem;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
}
</style>
