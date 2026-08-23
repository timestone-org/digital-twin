<script setup lang="ts">
/**
 * @fileoverview 分段编辑面：一行一档「当…取…」，可增删可上下移，末尾固定一档
 * 「否则」。它**不是另一种存储**，只是同一行公式文本的另一种编辑面——改完由
 * `composeBranches` 拼回那一行（docs/DATASET_DESIGN.md §7.6）。
 *
 * ⚠ 各档是**受控**的：本组件不留草稿，一改就把整份草稿抛给编辑器去拼。留一份
 * 本地副本就会出现「界面上是这样、落库的是那样」。
 * ⚠ 分支有序：第一个成立的那一档说了算，所以上下移是语义操作不是排版操作。
 */
import { computed, nextTick, ref } from 'vue'
import { DtButton, DtTextarea } from '@dt/ui'

import { toCards, type FieldId } from '../scripts/branchCards'
import {
  spliceText,
  type BranchArm,
  type BranchDraft,
} from '../scripts/formulaText'

const props = defineProps<{ draft: BranchDraft }>()

const emit = defineEmits<{ change: [next: BranchDraft] }>()

interface TextareaHost {
  textareaEl?: HTMLTextAreaElement | null
}

/**
 * 存的是 `DtTextarea` 的实例而不是它内部那个 textarea：`textareaEl` 要**用的
 * 时候再取**。ref 回调触发时实例的 el 可能还没赋上，当场取一次会把 null 记死，
 * 之后这一格就永远认不出焦点——表现是「工具箱插不进这一格」，且不报任何错。
 */
const hosts = new Map<FieldId, TextareaHost>()
/** 最近获得焦点的那一格与它的选区——工具箱插入没有别的依据可用。 */
const active = ref<{ id: FieldId; start: number; end: number } | null>(null)

const cards = computed(() => toCards(props.draft))

function bind(id: FieldId, instance: unknown): void {
  if (instance !== null && typeof instance === 'object') {
    hosts.set(id, instance)
    return
  }
  hosts.delete(id)
}

function elementOf(id: FieldId): HTMLTextAreaElement | null {
  return hosts.get(id)?.textareaEl ?? null
}

function syncSelection(id: FieldId): void {
  const element = elementOf(id)
  if (element === null) return
  active.value = {
    id,
    start: element.selectionStart,
    end: element.selectionEnd,
  }
}

function fieldOf(id: FieldId): string {
  if (id === 'else') return props.draft.otherwise
  const [index, which] = id.split('.')
  const arm = props.draft.arms[Number(index)]
  if (arm === undefined) return ''
  return which === 'cond' ? arm.cond : arm.value
}

/** 当前聚焦格里选中的文本；工具箱据此决定「套住选中」还是「插在光标处」。 */
const selection = computed(() => {
  const at = active.value
  if (at === null || at.start === at.end) return ''
  return fieldOf(at.id).slice(at.start, at.end)
})

function emitDraft(arms: BranchArm[], otherwise: string): void {
  emit('change', { arms, otherwise, form: props.draft.form })
}

function writeField(id: FieldId, text: string): void {
  if (id === 'else') {
    emitDraft(props.draft.arms, text)
    return
  }
  const [index, which] = id.split('.')
  const at = Number(index)
  // 档位不在场就什么都不做：照常上抛一份没变的草稿，父组件会照着重拼一遍公式，
  // 看起来像「插入生效了」，其实一个字都没进去
  if (props.draft.arms[at] === undefined) return
  const next = props.draft.arms.map((arm, one) =>
    one === at
      ? { ...arm, ...(which === 'cond' ? { cond: text } : { value: text }) }
      : arm,
  )
  emitDraft(next, props.draft.otherwise)
}

function exists(id: FieldId): boolean {
  return (
    id === 'else' || props.draft.arms[Number(id.split('.')[0])] !== undefined
  )
}

/**
 * 把片段插进当前聚焦的那一格。谁都没聚焦过就插进第一档的条件——静默丢弃会让
 * 用户以为工具箱坏了。
 * @param snippet 要插入的片段
 * @param caret 光标相对片段起点的偏移
 */
async function insert(snippet: string, caret: number): Promise<void> {
  const fallback = {
    id: props.draft.arms.length > 0 ? '0.cond' : 'else',
    start: 0,
    end: 0,
  }
  const current = active.value
  const at = current !== null && exists(current.id) ? current : fallback
  const next = spliceText(fieldOf(at.id), at.start, at.end, snippet, caret)
  writeField(at.id, next.text)
  active.value = { id: at.id, start: next.start, end: next.end }
  await nextTick()
  const element = elementOf(at.id)
  if (element === null) return
  element.focus()
  element.setSelectionRange(next.start, next.end)
}

defineExpose({ insert, selection })

/**
 * 增删移之后把 `active` 跟着挪：它记的是「第几档.哪一格」，而增删移改的正是
 * 「第几档」。不跟着挪，下一次插入就落进**别的档**，或者落进一个已经不存在
 * 的档位——什么都没插进去，也什么都不报。
 * @param moved 旧档位 → 新档位，返回 null 表示那一档没了
 */
function remap(moved: (at: number) => number | null): void {
  const current = active.value
  if (current === null || current.id === 'else') return
  const [index, which] = current.id.split('.')
  const to = moved(Number(index))
  active.value = to === null ? null : { ...current, id: `${to}.${which}` }
}

function addArm(): void {
  // 追加在末尾，已有档位序号不变，active 无需重映射
  emitDraft(
    [...props.draft.arms, { cond: '', value: '' }],
    props.draft.otherwise,
  )
}

function removeArm(at: number): void {
  remap((one) => (one === at ? null : one > at ? one - 1 : one))
  emitDraft(
    props.draft.arms.filter((_, one) => one !== at),
    props.draft.otherwise,
  )
}

function moveArm(at: number, delta: -1 | 1): void {
  const to = at + delta
  const moving = props.draft.arms[at]
  if (moving === undefined || to < 0 || to >= props.draft.arms.length) return
  remap((one) => (one === at ? to : one === to ? at : one))
  const next = [...props.draft.arms]
  next.splice(at, 1)
  next.splice(to, 0, moving)
  emitDraft(next, props.draft.otherwise)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <template v-for="card in cards" :key="card.key">
      <DtButton
        v-if="card.isElse"
        variant="ghost"
        intent="neutral"
        size="sm"
        icon="plus"
        class="self-start"
        @click="addArm"
      >
        加一个分支
      </DtButton>

      <div
        class="fb-arm flex flex-col gap-1 p-2"
        :class="{ 'fb-arm--else': card.isElse }"
      >
        <div class="flex items-center gap-1">
          <span class="fb-head">
            {{ card.isElse ? '否则' : `分支 ${card.at + 1}` }}
          </span>
          <span class="flex-1"></span>
          <DtButton
            v-if="!card.isElse"
            variant="ghost"
            intent="neutral"
            size="sm"
            icon="chevron-up"
            :disabled="card.at === 0"
            :aria-label="`第 ${card.at + 1} 档上移`"
            @click="moveArm(card.at, -1)"
          />
          <DtButton
            v-if="!card.isElse"
            variant="ghost"
            intent="neutral"
            size="sm"
            icon="chevron-down"
            :disabled="card.at === cards.length - 2"
            :aria-label="`第 ${card.at + 1} 档下移`"
            @click="moveArm(card.at, 1)"
          />
          <DtButton
            v-if="!card.isElse"
            variant="ghost"
            intent="danger"
            size="sm"
            icon="trash"
            :aria-label="`删除第 ${card.at + 1} 档`"
            @click="removeArm(card.at)"
          />
        </div>

        <div
          v-for="field in card.fields"
          :key="field.id"
          class="fb-field flex items-start gap-2"
        >
          <span class="fb-tag">{{ field.tag }}</span>
          <DtTextarea
            :ref="(instance) => bind(field.id, instance)"
            :model-value="field.text"
            :rows="1"
            size="sm"
            mono
            autosize
            spellcheck="false"
            :aria-label="field.label"
            :placeholder="field.placeholder"
            @update:model-value="writeField(field.id, $event)"
            @click="syncSelection(field.id)"
            @keyup="syncSelection(field.id)"
            @select="syncSelection(field.id)"
            @focus="syncSelection(field.id)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 抬头与「当 / 取」写成类名而不是一串工具类：一行装不下时 prettier 会把闭合
   尖括号折到下一行，而结构闸的闭合标签正则认不出那种写法 */
.fb-head {
  color: var(--text-disabled);
  font-size: 11px;
}

.fb-tag {
  padding-top: 6px;
  color: var(--text-disabled);
  font-size: 11px;
  white-space: nowrap;
}

.fb-arm {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

/* 兜底那一档换个底色：它没有条件，与上面几档不是同一种东西 */
.fb-arm--else {
  background: var(--surface-sunken);
}

/* DtTextarea 是 inheritAttrs:false，class 会落到内层的 textarea 上，
   这一格的宽度只能由外面这层撑开 */
.fb-field > :last-child {
  min-width: 0;
  flex: 1;
}
</style>
