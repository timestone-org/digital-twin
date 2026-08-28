<script setup lang="ts">
/**
 * @fileoverview 诊断清单：把 `collectTwin2dIssues` 的产出逐条列出来，点一条跳到出
 * 问题的那个实体。它只报不修——静默清理悬空引用会让用户以为自己配的东西凭空消失了。
 *
 * ⚠ 吃的是**原始** config，不是归一化输出：「归一化整条丢掉了什么」那一族
 * （`dropped-*` / `prim-too-deep` / `dangling-sprite`）只有拿原始 JSON 才查得到，
 * 喂归一化结果进来那一族永远是空的，而面板照样报绿（§4.2）。
 * ⚠ 预置样式库也要算「认识」：不递进去的话整张图的节点会被逐个报成悬空样式，
 * 真正那几条问题就此淹没在几十行噪音里（§13.4）。
 * ⚠ 两族诊断的下标活在两个空间里（引用完整性那族按归一化后的下标、丢弃那族按原始
 * 下标）。所以「跳过去」只在两个空间的同一位置指着同一个 id 时才给点：对不上的那些
 * 行只显示、不可点，而不是跳到一个无辜的邻居身上——跳错比不能跳难查得多。
 */
import { idOf, isRecord, toArray } from '@dt/twin2d'
import type { Twin2dIssue, Twin2dIssueCode, Twin2dIssueLevel } from '@dt/twin2d'
import { DtEmpty, DtIcon, DtTag } from '@dt/ui'
import { computed } from 'vue'

import { twin2dScan } from '../scripts/twin2dIssues'
import type { Twin2dEntityKind, Twin2dSelection } from '../scripts/types'

const props = defineProps<{
  /**
   * 这块 2D 孪生的**原始** `configJson.twin2d`；归一化在诊断入口里自己做一趟。
   * ⚠ 递归一化后的结果进来不会报错，只是「被整条丢掉了什么」那一族恒为空。
   */
  config: unknown
}>()

const emit = defineEmits<{
  /** 点了一行：跳到出问题的那个实体并选中它。 */
  select: [target: Twin2dIssueTarget]
}>()

/**
 * 诊断的 `at` 指得到的四类实体。
 * ⚠ 从 `Twin2dEntityKind` 里取而不是另写字面量：实体集合改名时这里编译期就红。
 * ⚠ `edgeStyles` 不在其中——没有一条诊断的 `at` 是从它起头的。
 */
type Twin2dIssueKind = Extract<
  Twin2dEntityKind,
  'nodes' | 'edges' | 'marks' | 'styles'
>

/** 跳过去的落点；画布那一档指不到，从选中里排掉。 */
type Twin2dIssueTarget = Exclude<Twin2dSelection, { kind: 'canvas' }>

/** 列表里的一行：一条诊断加上它能不能跳。 */
interface Twin2dIssueRow {
  key: string
  issue: Twin2dIssue
  target: Twin2dIssueTarget | null
}

/** 两档严重度各自的画法：图标、色与那枚小标签。 */
interface Twin2dLevelLook {
  icon: string
  tone: string
  tag: 'danger' | 'warning'
  text: string
}

const TARGET_KINDS: readonly Twin2dIssueKind[] = [
  'nodes',
  'edges',
  'marks',
  'styles',
]

/** `at` 的头一段：`nodes[3].styleId` 里的 `nodes` 与 `3`。 */
const AT_HEAD = /^([a-zA-Z]+)\[(\d+)\]/

/**
 * 十六种问题各自的短标签。
 * ⚠ 铺满 `Twin2dIssueCode` 而不是按前缀拼：新增一种 code 时这里编译期就红，
 * 拼出来的那份只会给新 code 显示一个空标签。
 */
const ISSUE_LABELS: Readonly<Record<Twin2dIssueCode, string>> = {
  'dangling-style': '样式找不到',
  'dangling-port': '端口找不到',
  'dangling-slot': '槽位找不到',
  'dangling-prim': '覆盖补丁落空',
  'dangling-variant-prim': '变体补丁落空',
  'dangling-gradient': '渐变找不到',
  'dangling-sprite': '内置图标找不到',
  'waypoint-out-of-canvas': '拐点在画布外',
  'node-out-of-canvas': '节点在画布外',
  'prim-too-deep': '图元树过深',
  'dropped-node': '节点被丢掉',
  'dropped-edge': '连线被丢掉',
  'dropped-mark': '标注被丢掉',
  'dropped-prim': '图元被丢掉',
  'dropped-slot': '槽位被丢掉',
  'dropped-port': '端口被丢掉',
  'dropped-variant': '变体被丢掉',
}

/**
 * 两档严重度分得开：图标、颜色与文字三处一起变。
 * ⚠ 只靠颜色分的话，色觉障碍与黑白截图两种情形下这两档就完全一样了。
 */
const LEVEL_LOOK: Readonly<Record<Twin2dIssueLevel, Twin2dLevelLook>> = {
  error: {
    icon: 'alert-triangle',
    tone: 'text-state-danger',
    tag: 'danger',
    text: '画不出来',
  },
  warn: {
    icon: 'alert-circle',
    tone: 'text-state-warning',
    tag: 'warning',
    text: '与配置不符',
  },
}

/**
 * 诊断走 `twin2dIssues` 那一支，本层不另调一遍 `collectTwin2dIssues`：顶栏那个计数
 * 读的是同一支，各调各的话两处迟早对同一份配置报出两个数。
 * 里头的归一化结果只用来核对下标与查预置样式，诊断本身吃的是原始那一份。
 */
const scan = computed(() => twin2dScan(props.config))

const issues = computed<readonly Twin2dIssue[]>(() => scan.value.issues)

/**
 * `at` 头一段里的实体集合名；不是那四类之一给 null。
 * @param text 头一段的原文
 */
function kindOf(text: string): Twin2dIssueKind | null {
  return TARGET_KINDS.find((kind) => kind === text) ?? null
}

/**
 * 归一化后这个位置上那一条的 id；越界给空串。
 * @param kind 实体集合
 * @param index 集合内下标
 */
function liveIdAt(kind: Twin2dIssueKind, index: number): string {
  const rows: readonly { id: string }[] = scan.value.live[kind]
  return rows[index]?.id ?? ''
}

/**
 * 原始文档里这个位置上那一条的 id；不是对象或没写 id 给空串。
 * @param kind 实体集合
 * @param index 集合内下标
 */
function rawIdAt(kind: Twin2dIssueKind, index: number): string {
  const source = isRecord(props.config) ? props.config : {}
  const row = toArray(source[kind])[index]
  return isRecord(row) ? idOf(row.id) : ''
}

/**
 * 这一条能跳到哪个实体；跳不过去给 null。
 * ⚠ 两个空间的同一位置必须指着同一个 id 才给点：被整条丢掉的那些（`dropped-*`）
 * 在归一化结果里根本不存在，硬跳过去会选中一个无辜的邻居，而那比不能跳难查得多。
 * @param at 诊断里的字段路径
 */
function targetOf(at: string): Twin2dIssueTarget | null {
  const [, rawKind = '', rawIndex = ''] = AT_HEAD.exec(at) ?? []
  const kind = kindOf(rawKind)
  const index = Number.parseInt(rawIndex, 10)
  if (kind === null || !Number.isInteger(index)) return null
  const id = rawIdAt(kind, index)
  return id !== '' && liveIdAt(kind, index) === id ? { kind, id } : null
}

// ⚠ 同一条路径上可能同时报出两条不同的问题，所以键里带上文档序
const rows = computed<readonly Twin2dIssueRow[]>(() =>
  issues.value.map((issue, order) => ({
    key: `${order}:${issue.code}:${issue.at}`,
    issue,
    target: targetOf(issue.at),
  })),
)

/** 按档计数，只列有的那几档；两档都没有时整块落空态。 */
const counts = computed(() =>
  Object.entries(LEVEL_LOOK)
    .map(([level, look]) => ({
      key: level,
      look,
      total: issues.value.filter((issue) => issue.level === level).length,
    }))
    .filter((entry) => entry.total > 0),
)

/**
 * 点一行。
 * @param row 这一行
 */
function pick(row: Twin2dIssueRow): void {
  if (row.target !== null) emit('select', row.target)
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-test="twin2d-diagnostics">
    <DtEmpty
      v-if="rows.length === 0"
      size="inline"
      icon="check"
      title="没有发现配置问题"
      hint="悬空引用、被丢掉的条目与越界拐点都会在这里逐条列出"
      data-test="diagnostics-empty"
    />
    <div v-else class="flex items-center gap-1.5 text-3xs text-text-disabled">
      <span data-test="diagnostics-total">{{ rows.length }} 条问题</span>
      <DtTag
        v-for="entry in counts"
        :key="entry.key"
        size="sm"
        :intent="entry.look.tag"
        >{{ entry.look.text }} {{ entry.total }}</DtTag
      >
    </div>
    <button
      v-for="row in rows"
      :key="row.key"
      type="button"
      class="flex w-full flex-col gap-0.5 rounded-[var(--radius-sm)] border border-border-subtle px-2 py-1.5 text-left text-2xs text-text-secondary enabled:hover:border-accent-primary enabled:hover:text-text-primary disabled:cursor-default"
      data-test="diagnostics-row"
      :data-code="row.issue.code"
      :data-level="row.issue.level"
      :title="`${row.issue.at}：${row.issue.message}`"
      :disabled="row.target === null"
      @click="pick(row)"
    >
      <span
        class="flex items-center gap-1"
        :class="LEVEL_LOOK[row.issue.level].tone"
      >
        <DtIcon :name="LEVEL_LOOK[row.issue.level].icon" :size="12" />
        <span class="font-medium">{{ ISSUE_LABELS[row.issue.code] }}</span>
        <span
          class="min-w-0 flex-1 truncate text-3xs text-text-disabled"
          data-test="diagnostics-at"
          >{{ row.issue.at }}</span
        >
      </span>
      <span>{{ row.issue.message }}</span>
    </button>
  </div>
</template>
