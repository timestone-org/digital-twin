<script setup lang="ts">
/**
 * @fileoverview 知识库管理：左边选库，右边看文档摄取状态、传文档，再拿检索试验台试一句。
 *
 * ⚠ 文档字节从不经过本站 API：上传是浏览器凭签好的表单直传对象存储（ADR-0015），
 * 这一页只管那张表与那几个按钮。
 * ⚠ 两路索引走在哪一档要如实显示：走回退档时检索会明显变慢变弱，而不说的话
 * 没有人会去查一件没人说过的事（ADR-0034 决策五）。
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
  useConfirm,
  useToast,
} from '@dt/ui'

import type { KnowledgeBase, KnowledgeDocument } from '@/api/knowledge'
import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import KnowledgeBaseFormDialog from './components/KnowledgeBaseFormDialog.vue'
import KnowledgeBaseHeader from './components/KnowledgeBaseHeader.vue'
import KnowledgeBaseList from './components/KnowledgeBaseList.vue'
import KnowledgeDocumentTable from './components/KnowledgeDocumentTable.vue'
import KnowledgeSearchPanel from './components/KnowledgeSearchPanel.vue'
import { useIngestPolling } from './scripts/useIngestPolling'
import { useKnowledgePage } from './scripts/useKnowledgePage'

const page = useKnowledgePage()
const toast = useToast()
const confirm = useConfirm()

useIngestPolling(page.documents, page.refreshDocuments)

const isCreating = ref(false)
const isSubmitting = ref(false)
const createError = ref('')

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
        <DtButton size="sm" icon="plus" @click="openCreate">
          新建知识库
        </DtButton>
      </PermGuard>
    </template>

    <!-- ⚠ 这一页必须自己能滚：窄屏（<xl）时左栏、文档表、试验台是竖着堆的，加起来
         必然高过视口，而 AppShell 的 `<main>` 是 overflow-hidden、自己不滚 -->
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <DtNotice v-if="page.error.value !== ''" intent="danger">
        {{ page.error.value }}
      </DtNotice>

      <!-- ⚠ 走回退档时如实说出来：悄悄退化的表现是「检索有点慢、有点不准」，
           而没有人会去查一件没人说过的事 -->
      <DtNotice
        v-if="page.indexHint.value !== ''"
        intent="warning"
        icon="alert-triangle"
      >
        {{ page.indexHint.value }}
      </DtNotice>

      <!-- ⚠ `flex-1` 只在 ≥xl 给：窄屏时要让这块按内容撑开，交给外面那层滚 -->
      <div
        class="grid min-h-0 grid-cols-1 gap-4 xl:flex-1 xl:grid-cols-[20rem_minmax(0,1fr)]"
      >
        <aside class="flex h-60 min-w-0 shrink-0 flex-col xl:h-auto xl:min-h-0">
          <KnowledgeBaseList
            :bases="page.bases.value"
            :selected-id="page.selectedId.value"
            :loading="page.isLoading.value"
            @select="page.select"
            @reload="page.reload"
            @create="openCreate"
          />
        </aside>

        <section class="flex min-h-0 min-w-0 flex-col gap-4">
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

            <!-- 文档表 + 试验台：<2xl 竖排固定高、交给外层滚；≥2xl 并排铺满内部滚动。
                 ⚠ 并排的门槛是 2xl 不是 xl：xl 那一档右区只剩八百多像素，分给文档表
                 的一半连文档名都截成七个字，而名字是这张表唯一的识别依据 -->
            <div
              class="grid min-h-0 grid-cols-1 gap-4 2xl:flex-1 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] 2xl:grid-rows-1"
            >
              <KnowledgeDocumentTable
                class="h-120 shrink-0 2xl:h-auto"
                :documents="page.documents.value"
                :loading="page.isLoading.value"
                @reparse="reparse"
                @remove="removeDocument"
              />
              <KnowledgeSearchPanel
                class="h-120 shrink-0 2xl:h-auto"
                :query="page.query.value"
                :searched="page.searched.value"
                :result="page.result.value"
                :is-searching="page.isSearching.value"
                @update:query="(value: string) => (page.query.value = value)"
                @search="page.search"
              />
            </div>
          </template>

          <!-- 未选中库（新建入口在左栏与顶栏，这里只指路） -->
          <DtCard v-else class="flex min-h-0 flex-1 flex-col justify-center">
            <DtEmpty
              icon="folder-open"
              title="选择一个知识库"
              hint="从左侧选一个，或者新建一个再往里传文档。"
            />
          </DtCard>
        </section>
      </div>
    </div>

    <KnowledgeBaseFormDialog
      v-model="isCreating"
      :is-busy="isSubmitting"
      :error="createError"
      @submit="createBase"
    />
  </AppShell>
</template>
