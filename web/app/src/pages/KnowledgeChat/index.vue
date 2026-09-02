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
import { onMounted } from 'vue'
import { DtNotice } from '@dt/ui'

import AiTimeline from '@/components/ai/AiTimeline.vue'
import { AppShell } from '@/components/layout'
import ChatSessionList from './components/ChatSessionList.vue'
import KnowledgeChatComposer from './components/KnowledgeChatComposer.vue'
import { useKnowledgeChatPage } from './scripts/useKnowledgeChatPage'

const page = useKnowledgeChatPage()

/** 空态里可点的几句开场。点了填进输入框由用户自己发，不直接发出去。 */
const STARTERS = [
  '这套资料里有哪些设备？',
  '冷却水出口温度的上限是多少？',
  '润滑周期是怎么规定的？',
] as const

onMounted(() => void page.reload())
</script>

<template>
  <AppShell
    title="知识库对话"
    subtitle="对着手册、规程与台账资料提问，答复带出处"
  >
    <div class="flex h-full min-h-0 gap-4">
      <ChatSessionList
        :sessions="page.sessions.value"
        :selected-id="page.selectedId.value"
        :is-busy="page.isLoading.value"
        @select="page.select"
        @create="page.create"
        @rename="page.rename"
        @archive="page.archive"
        @remove="page.remove"
      />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <DtNotice v-if="page.error.value !== ''" intent="danger">
          {{ page.error.value }}
        </DtNotice>

        <AiTimeline
          :entries="page.chat.entries.value"
          :starters="STARTERS"
          empty-title="问一句资料里的事"
          @starter="(text: string) => void page.send(text)"
          @answer="page.chat.answerAsk"
        />

        <KnowledgeChatComposer
          :running="page.chat.isRunning.value"
          :asking="page.chat.isAsking.value"
          @send="page.send"
          @stop="page.chat.stop"
        />
      </div>
    </div>
  </AppShell>
</template>
