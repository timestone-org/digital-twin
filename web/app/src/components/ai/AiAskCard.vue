<script setup lang="ts">
/**
 * @fileoverview 助手向用户提问的那张卡片：一句问题 + 一排可点的选项。
 *
 * ⚠ 选项是主路、打字是逃生口。单选时点一下就答完——八成的情况到此为止；
 * 多选与自由输入才多一步「确定」（AI_ASSISTANT_ASK_DESIGN §2）。
 *
 * ⚠ 「我自己说」回的是 `is_cancelled: true`，那是一条**正常回执**：回合据它
 * 继续往下走，输入框随即解禁。做成「打字即取消」的话，用户的新消息会与正在
 * 跑的回合抢同一条时间线，谁后到谁覆盖。
 *
 * ⚠ 答完就地收起，只留一行「你选了：…」。回放出来的历史里没有这张卡片——
 * 那一轮早结束了，点了没有人在等这个答案（`features/ai/replayLog.ts`）。
 */
import { computed, ref } from 'vue'
import type { AssistantAskAnswer } from '@dt/contracts'
import { DtButton, DtInput } from '@dt/ui'

import type { AskEntry } from '@/features/ai/conversationLog'

const props = defineProps<{ ask: AskEntry }>()

const emit = defineEmits<{ answer: [answer: AssistantAskAnswer] }>()

const request = computed(() => props.ask.request)
const isAnswered = computed(() => props.ask.answer !== null)

/** 多选时已经点亮的那几项。单选不用它——点一下就答完了。 */
const picked = ref<string[]>([])
const draft = ref('')

/** 多选与自由输入要一颗「确定」；单选点一下即是答案。 */
const needsConfirm = computed(
  () => request.value.allow_multiple || request.value.allow_free_text,
)

const canConfirm = computed(
  () => picked.value.length > 0 || draft.value.trim() !== '',
)

function isPicked(value: string): boolean {
  return picked.value.includes(value)
}

function onOption(value: string): void {
  if (!request.value.allow_multiple) {
    emit('answer', { picked: [value], free_text: null, is_cancelled: false })
    return
  }
  picked.value = isPicked(value)
    ? picked.value.filter((one) => one !== value)
    : [...picked.value, value]
}

function confirm(): void {
  if (!canConfirm.value) return
  const text = draft.value.trim()
  emit('answer', {
    picked: [...picked.value],
    free_text: text === '' ? null : text,
    is_cancelled: false,
  })
}

/** 「我自己说」：正常回执，不是失败。 */
function cancel(): void {
  emit('answer', { picked: [], free_text: null, is_cancelled: true })
}

function labelOf(value: string): string {
  const one = request.value.options.find((option) => option.value === value)
  return one?.label ?? value
}

/** 收起之后留下的那一行。 */
const answeredText = computed(() => {
  const answer = props.ask.answer
  if (answer === null) return ''
  if (answer.is_cancelled) return '你说要自己讲'
  const parts = answer.picked.map(labelOf)
  if (answer.free_text !== null && answer.free_text !== '') {
    parts.push(answer.free_text)
  }
  return `你选了：${parts.join('、')}`
})

const freeTextLabel = computed(
  () => request.value.free_text_label ?? '或者自己写一句',
)
</script>

<template>
  <li class="ai-ask" :class="{ 'ai-ask--done': isAnswered }">
    <p class="ai-ask__question">{{ request.question }}</p>

    <p v-if="isAnswered" class="ai-ask__answer">{{ answeredText }}</p>

    <template v-else>
      <ul class="ai-ask__options">
        <li v-for="one in request.options" :key="one.value">
          <button
            type="button"
            class="ai-ask__option"
            :class="{ 'ai-ask__option--on': isPicked(one.value) }"
            :aria-pressed="
              request.allow_multiple ? isPicked(one.value) : undefined
            "
            @click="onOption(one.value)"
          >
            <span class="ai-ask__label">{{ one.label }}</span>
            <span v-if="one.hint" class="ai-ask__hint">{{ one.hint }}</span>
          </button>
        </li>
      </ul>

      <DtInput
        v-if="request.allow_free_text"
        v-model="draft"
        class="ai-ask__free"
        size="sm"
        :placeholder="freeTextLabel"
        :aria-label="freeTextLabel"
        @enter="confirm"
      />

      <div class="ai-ask__acts">
        <DtButton
          v-if="needsConfirm"
          size="sm"
          :disabled="!canConfirm"
          @click="confirm"
        >
          确定
        </DtButton>
        <DtButton
          class="ai-ask__mine"
          variant="ghost"
          intent="neutral"
          size="sm"
          title="不按选项来，自己在下面打字说"
          @click="cancel"
        >
          我自己说
        </DtButton>
      </div>
    </template>
  </li>
</template>

<style scoped lang="scss">
/* 助手在等人，所以这张卡是时间线上唯一带实底与描边的一块：一眼看出
   「轮到我了」。答完就褪成一行普通说明。 */
.ai-ask {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
  box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.12);
}

.ai-ask--done {
  gap: 0.25rem;
  border-color: var(--border-default);
  box-shadow: none;
}

.ai-ask__question {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.875rem;
  line-height: 1.6;
}

.ai-ask--done .ai-ask__question {
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.ai-ask__answer {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.ai-ask__options {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-ask__option {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  width: 100%;
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.ai-ask__option:hover {
  border-color: var(--accent-primary);
}

/* 多选点亮的那几项：底色换掉而不是只描边——只描边的话，与 hover 分不开 */
.ai-ask__option--on {
  border-color: var(--accent-primary);
  background: rgba(var(--accent-primary-rgb), 0.14);
}

.ai-ask__option:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 1px;
}

.ai-ask__hint {
  color: var(--text-secondary);
  font-size: 0.6875rem;
}

.ai-ask__acts {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.ai-ask__mine {
  margin-left: auto;
}

@media (prefers-reduced-motion: reduce) {
  .ai-ask__option {
    transition: none;
  }
}
</style>
