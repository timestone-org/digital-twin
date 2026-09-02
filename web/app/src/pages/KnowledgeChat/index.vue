<script setup lang="ts">
/**
 * @fileoverview 知识库对话：对着传上来的资料多轮提问，模型自己决定检索几次，
 * 歧义时反问并给选项让人选，对话可列可改可归档（docs/KNOWLEDGE_CHAT_DESIGN.md）。
 *
 * 时间线、反问卡片、步骤卡片与助手共用同一批组件（`components/ai`）：
 * 两边渲染的是同一种东西，各画一份一定会漂。
 * ⚠ 每条召回的出处（哪个库 / 哪份文档 / 哪个位置）由模型写进答复里，
 * 这一页不另拼一份——跨库是模型自己挑的，出处必须跟着它的答复走。
 * 交互编排在 `scripts/useKnowledgeChatPage.ts`。
 */
import { computed, onMounted } from 'vue'
import { DtButton, DtNotice } from '@dt/ui'

import { AppShell } from '@/components/layout'
import ChatPanel from './components/ChatPanel.vue'
import ChatSessionList from './components/ChatSessionList.vue'
import { sessionLabel } from './scripts/sessionLabel'
import { useKnowledgeChatPage } from './scripts/useKnowledgeChatPage'

const page = useKnowledgeChatPage()

/** 空态里可点的几句开场。点了直接发出去。 */
const STARTERS = [
  '这套资料里有哪些设备？',
  '冷却水出口温度的上限是多少？',
  '润滑周期是怎么规定的？',
] as const

/** 标题栏上写的当前对话名；没选中时 null。 */
const selectedLabel = computed<string | null>(() => {
  const one = page.sessions.value.find(
    (each) => each.id === page.selectedId.value,
  )
  return one === undefined ? null : sessionLabel(one)
})

onMounted(() => void page.reload())
</script>

<template>
  <AppShell
    title="知识库对话"
    subtitle="对着手册、规程与台账资料提问，答复带出处"
  >
    <template #actions>
      <DtButton
        size="sm"
        icon="plus"
        :disabled="page.isLoading.value"
        @click="page.create"
      >
        新对话
      </DtButton>
    </template>

    <!-- ⚠ 这一页不整页滚：高度钉在视口里，时间线在面板内部自己滚，
         输入区才能一直钉在底部 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="page.error.value !== ''" intent="danger">
        {{ page.error.value }}
      </DtNotice>

      <!-- <xl 竖排：左栏定高，面板吃掉剩下的那一行；≥xl 并成两栏 -->
      <div
        class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] xl:grid-rows-1"
      >
        <aside class="flex h-56 min-w-0 shrink-0 flex-col xl:h-auto xl:min-h-0">
          <ChatSessionList
            :sessions="page.sessions.value"
            :selected-id="page.selectedId.value"
            @select="page.select"
            @rename="page.rename"
            @archive="page.archive"
            @remove="page.remove"
          />
        </aside>

        <section class="flex min-h-0 min-w-0 flex-col">
          <ChatPanel
            :chat="page.chat"
            :title="selectedLabel"
            :starters="STARTERS"
            @send="(text: string) => void page.send(text)"
          />
        </section>
      </div>
    </div>
  </AppShell>
</template>
