<script setup lang="ts">
/**
 * @fileoverview 知识库：建库、传文档、看摄取状态，以及一个检索试验台。
 *
 * ⚠ 文档字节从不经过本站 API：上传是浏览器凭签好的表单直传对象存储（ADR-0015），
 * 这一页只管那张表与那几个按钮。
 * ⚠ 摄取是**异步**的：传完之后文档停在「待处理」，由后台的 worker 接手解析、
 * 切块、嵌入。界面上给一个刷新入口——不给的话，用户只会一直盯着一个不动的状态。
 * ⚠ 两路索引走在哪一档要如实显示：走回退档时检索会明显变慢变弱，而不说的话
 * 没有人会去查一件没人说过的事（ADR-0034 决策五）。
 * 交互编排在 `scripts/useKnowledgePage.ts`。
 */
import { onMounted } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtEmpty, DtFilePicker, DtNotice, DtProgress } from '@dt/ui'

import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import KnowledgeBaseList from './components/KnowledgeBaseList.vue'
import KnowledgeDocumentTable from './components/KnowledgeDocumentTable.vue'
import KnowledgeSearchPanel from './components/KnowledgeSearchPanel.vue'
import { useKnowledgePage } from './scripts/useKnowledgePage'

const page = useKnowledgePage()

onMounted(() => void page.reload())
</script>

<template>
  <AppShell title="知识库" subtitle="手册、规程与外部系统资料的检索底座">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.knowledgeWrite]" explain>
        <DtFilePicker
          :accept="page.accept.value"
          multiple
          :disabled="page.selectedId.value === '' || page.upload.value !== null"
          :label="page.upload.value === null ? '传文档' : '上传中…'"
          size="sm"
          @select="page.addFiles"
        />
      </PermGuard>
    </template>

    <div class="flex h-full min-h-0 gap-4">
      <KnowledgeBaseList
        :bases="page.bases.value"
        :selected-id="page.selectedId.value"
        @select="page.select"
        @create="page.create"
        @drop="page.drop"
      />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
        <DtNotice v-if="page.error.value !== ''" intent="danger">
          {{ page.error.value }}
        </DtNotice>

        <!-- ⚠ 走回退档时如实说出来。悄悄退化的表现是「检索有点慢、有点不准」，
             而没有人会去查一件没人说过的事 -->
        <DtNotice v-if="page.indexHint.value !== ''" intent="warning">
          {{ page.indexHint.value }}
        </DtNotice>

        <DtProgress
          v-if="page.upload.value !== null"
          :value="page.upload.value.ratio * 100"
          :label="`正在上传 ${page.upload.value.name}`"
        />

        <DtEmpty
          v-if="page.selected.value === null"
          title="先选一个知识库"
          description="左边选一个，或者新建一个再往里传文档"
        />

        <template v-else>
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-base">{{ page.selected.value.name }}</h2>
            <DtButton
              variant="ghost"
              size="sm"
              :loading="page.isLoading.value"
              @click="page.refreshDocuments"
            >
              刷新状态
            </DtButton>
          </div>

          <KnowledgeDocumentTable
            :documents="page.documents.value"
            @reparse="page.reparse"
            @remove="page.removeDocument"
          />

          <KnowledgeSearchPanel
            :query="page.query.value"
            :result="page.result.value"
            :is-searching="page.isSearching.value"
            @update:query="(value: string) => (page.query.value = value)"
            @search="page.search"
          />
        </template>
      </div>
    </div>
  </AppShell>
</template>
