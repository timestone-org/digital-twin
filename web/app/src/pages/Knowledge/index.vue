<script setup lang="ts">
/**
 * @fileoverview 知识库管理：左边选库，右边看文档摄取状态、传文档，再拿检索试验台试一句。
 *
 * ⚠ 文档字节从不经过本站 API：上传是浏览器凭签好的表单直传对象存储（ADR-0015），
 * 这一页只管那张表与那几个按钮。
 * ⚠ 索引那一格的毛病要如实显示：维数与库上那一列对不上时一份文档都摄不进来，
 * 而这句提示是在传文档之前唯一看得见它的地方（ADR-0045）。
 * 交互编排在 `scripts/useKnowledgePage.ts`，摄取轮询在 `scripts/useIngestPolling.ts`。
 */
import { onMounted, ref } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtEmpty,
  DtFilePicker,
  DtNotice,
  DtProgress,
  DtResizableLayout,
  useConfirm,
  useToast,
  DtIconButton,
} from '@dt/ui'

import type { KnowledgeBase, KnowledgeDocument } from '@/api/knowledge'
import { AppShell } from '@/components/layout'
import KnowledgeGuide from '@/features/knowledge/components/KnowledgeGuide.vue'
import KnowledgeMascot from '@/features/knowledge/components/KnowledgeMascot.vue'
import PermGuard from '@/components/PermGuard.vue'
import KnowledgeBaseFormDialog from './components/KnowledgeBaseFormDialog.vue'
import KnowledgeBaseHeader from './components/KnowledgeBaseHeader.vue'
import KnowledgeBaseList from './components/KnowledgeBaseList.vue'
import KnowledgeDocumentPreview from './components/KnowledgeDocumentPreview.vue'
import KnowledgeDocumentTable from './components/KnowledgeDocumentTable.vue'
import KnowledgeSearchPanel from './components/KnowledgeSearchPanel.vue'
import KnowledgeSourcesDialog from './components/KnowledgeSourcesDialog.vue'
import { useIngestPolling } from './scripts/useIngestPolling'
import { useKnowledgePage } from './scripts/useKnowledgePage'

const page = useKnowledgePage()
const toast = useToast()
const confirm = useConfirm()

useIngestPolling(page.documents, page.refreshDocuments)

const isCreating = ref(false)
const isSubmitting = ref(false)
const createError = ref('')
const isSourcesOpen = ref(false)
/** 正在预览的那一份；为空即弹窗关着。 */
const previewing = ref<KnowledgeDocument | null>(null)

onMounted(() => void page.reload())

function openCreate(): void {
  createError.value = ''
  isCreating.value = true
}

async function createBase(name: string, description: string): Promise<void> {
  isSubmitting.value = true
  try {
    if (await page.create(name, description)) {
      isCreating.value = false
    } else {
      createError.value = page.error.value
    }
  } finally {
    isSubmitting.value = false
  }
}

async function dropBase(base: KnowledgeBase): Promise<void> {
  const accepted = await confirm.ask({
    title: '删除知识库',
    message: `「${base.name}」名下的文档、它们的块与原件会一起删，不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!accepted) return
  if (await page.drop(base.id)) toast.success('已删除知识库')
}

async function addFiles(files: readonly File[]): Promise<void> {
  const uploaded = await page.addFiles(files)
  if (uploaded > 0) toast.success(`已传 ${uploaded} 份文档，后台正在处理`)
}

function preview(doc: KnowledgeDocument): void {
  previewing.value = doc
}

/**
 * 弹窗自己关上时把选中的那一份也放掉。
 * ⚠ 不放的话下次点同一份文档，`document` 没变、弹窗也就不会重新取字节——
 * 表现是「第二次点开是空的」。
 */
function onPreviewOpen(isOpen: boolean): void {
  if (!isOpen) previewing.value = null
}

async function reparse(doc: KnowledgeDocument): Promise<void> {
  if (await page.reparse(doc.id)) toast.success('已重新排队解析')
}

async function removeDocument(doc: KnowledgeDocument): Promise<void> {
  const accepted = await confirm.ask({
    title: '删除文档',
    message: `「${doc.title}」的块与原件会一起删，不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!accepted) return
  if (await page.removeDocument(doc.id)) toast.success('已删除文档')
}
</script>

<template>
  <AppShell title="知识库管理" subtitle="手册、规程与外部系统资料的检索底座">
    <template #actions>
      <DtButton
        size="sm"
        :disabled="page.selected.value === null"
        @click="isSourcesOpen = true"
      >
        来源配置
      </DtButton>
      <!-- explain：只读账号看不到写入口，这里如实说明原因，免得以为功能没做 -->
      <PermGuard :codes="[PERMISSION_CODES.knowledgeWrite]" explain>
        <DtFilePicker
          :accept="page.accept.value"
          multiple
          :disabled="page.selectedId.value === '' || page.upload.value !== null"
          :label="page.upload.value === null ? '传文档' : '上传中…'"
          size="sm"
          @select="addFiles"
        />
      </PermGuard>
      <PermGuard :codes="[PERMISSION_CODES.knowledgeManage]">
        <DtIconButton
          size="sm"
          variant="solid"
          intent="primary"
          icon="plus"
          label="新建知识库"
          @click="openCreate"
        />
      </PermGuard>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-4">
      <KnowledgeGuide />
      <DtNotice v-if="page.error.value !== ''" intent="danger">
        {{ page.error.value }}
      </DtNotice>

      <!-- ⚠ 索引有毛病时如实说出来：维数对不上会让每一份文档都摄取失败，
           而只看文档状态的话，那条错像是文档本身有问题 -->
      <DtNotice
        v-if="page.indexHint.value !== ''"
        intent="warning"
        icon="alert-triangle"
      >
        {{ page.indexHint.value }}
      </DtNotice>

      <DtResizableLayout
        class="min-h-0 flex-1"
        :panes="[
          { id: 'bases', label: '知识库列表', size: 1, minSize: 220 },
          { id: 'detail', label: '知识库详情', size: 3, minSize: 320 },
        ]"
        :stack-at="1000"
        storage-key="dt.knowledge.layout"
      >
        <template #bases>
          <aside class="flex h-full min-h-0 min-w-0 flex-col">
            <KnowledgeBaseList
              :bases="page.bases.value"
              :selected-id="page.selectedId.value"
              :loading="page.isLoading.value"
              @select="page.select"
              @reload="page.reload"
              @create="openCreate"
            />
          </aside>
        </template>

        <template #detail>
          <section class="flex h-full min-h-0 min-w-0 flex-col gap-4">
            <template v-if="page.selected.value !== null">
              <KnowledgeBaseHeader
                :base="page.selected.value"
                :document-count="page.documents.value.length"
                :refreshing="page.isRefreshing.value"
                @refresh="page.refreshDocuments"
                @remove="dropBase(page.selected.value)"
              />

              <div
                v-if="page.upload.value !== null"
                class="flex items-center gap-3"
              >
                <span class="shrink-0 text-xs text-text-secondary">
                  正在上传 {{ page.upload.value.name }}
                </span>
                <DtProgress
                  class="min-w-0 flex-1"
                  size="sm"
                  show-label
                  :value="page.upload.value.ratio * 100"
                />
              </div>

              <DtResizableLayout
                class="min-h-0 flex-1"
                style="min-height: 24rem"
                :panes="[
                  { id: 'documents', label: '文档列表', size: 3, minSize: 300 },
                  { id: 'search', label: '检索试验台', size: 2, minSize: 240 },
                ]"
                :stack-at="900"
                storage-key="dt.knowledge.documents-layout"
              >
                <template #documents>
                  <KnowledgeDocumentTable
                    class="h-full min-h-0 flex-1"
                    :documents="page.documents.value"
                    :loading="page.isLoading.value"
                    @preview="preview"
                    @reparse="reparse"
                    @remove="removeDocument"
                  />
                </template>
                <template #search>
                  <KnowledgeSearchPanel
                    class="h-full min-h-0 flex-1"
                    :query="page.query.value"
                    :searched="page.searched.value"
                    :result="page.result.value"
                    :is-searching="page.isSearching.value"
                    :rerank="page.capability.value?.rerank ?? null"
                    @update:query="
                      (value: string) => (page.query.value = value)
                    "
                    @search="page.search"
                  />
                </template>
              </DtResizableLayout>
            </template>

            <!-- 未选中库（新建入口在左栏与顶栏，这里只指路） -->
            <DtCard v-else class="flex min-h-0 flex-1 flex-col justify-center">
              <KnowledgeMascot scene="library" class="mx-auto" />
              <DtEmpty
                icon="folder-open"
                title="选择一个知识库"
                hint="从左侧选一个，或者新建一个再往里传文档。"
              />
            </DtCard>
          </section>
        </template>
      </DtResizableLayout>
    </div>

    <KnowledgeBaseFormDialog
      v-model="isCreating"
      :is-busy="isSubmitting"
      :error="createError"
      @submit="createBase"
    />

    <KnowledgeDocumentPreview
      :model-value="previewing !== null"
      :document="previewing"
      @update:model-value="onPreviewOpen"
    />
    <KnowledgeSourcesDialog
      v-model="isSourcesOpen"
      :base="page.selected.value"
      :source-kinds="page.capability.value?.sourceKinds ?? []"
      @synced="page.refreshDocuments"
    />
  </AppShell>
</template>
