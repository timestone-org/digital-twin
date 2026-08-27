<script lang="ts">
/**
 * @fileoverview info-list 的渲染：读一次形态与行，按分组摆成组头段或分类页签，
 * 交给共用的自动滚动视口，行本身由 `InfoRow` 画（MODULE_INFO_CARD_DESIGN §2）。
 *
 * ⚠ 迟滞的定时器由本文件持有、`onBeforeUnmount` 里清掉：`rows.ts` 只出纯函数，
 * 而「卸载必须清理」那道闸只扫 `.vue` 与 `use*.ts`，放进 `rows.ts` 等于让它失效。
 * ⚠ 顶层配置键在本文件里字面读一遍：判「声明了没人读」的那道闸认的是
 * `config.<键>` 这种写法，而绑定槽键那条闸只扫模块目录本身。
 */

/** 页签档里「不筛」那一页的键；分组名不可能是空串，故它不会与真页签相撞。 */
const ALL_TAB = ''

/** 「不筛」那一页的文案。 */
const ALL_TAB_LABEL = '全部'

/**
 * 没填分组的行落进这一段。
 * ⚠ 它不算任何一个具名页签的成员，也不计入具名页签的计数——参考仓把认不出的
 * 分类静默归进采暖，那是脏数据被算进别人计数里的一处语义回归。
 */
const OTHER_GROUP = '其它'
</script>

<script setup lang="ts">
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { readText, readTrimmedText } from '../../shared/config'
import { rowClickEmitter } from '../../shared/interaction'
import ModulePanel from '../../shared/ModulePanel.vue'
import { readScrollSettings } from '../../shared/scroll'
import ScrollList from '../../shared/ScrollList.vue'
import InfoRow from './InfoRow.vue'
import { readListLook } from './look'
import {
  LIST_SLOT_KEY,
  buildListRows,
  createHoldStore,
  isRowKept,
  readEmptyNote,
  readListPolicy,
  selectRows,
  sinceMap,
  type ListRow,
} from './rows'

/** 一段行：组头档才有组头，其余档是没有头的一整段。 */
interface RowBlock {
  key: string
  /** 组头文案；空串 = 这一段不画组头。 */
  head: string
  count: number
  rows: readonly ListRow[]
}

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

// 空值不上抛由它兜着；吞不吞冒泡由 InfoRow 按这一行有没有联动值分开决定
const onPick = rowClickEmitter(emit)

const look = computed(() => readListLook(props.config))

const policy = computed(() => readListPolicy(props.config))

const rows = computed(() =>
  buildListRows({
    config: props.config,
    rows: props.values[LIST_SLOT_KEY],
    slots: props.meta?.slots,
    look: look.value,
  }),
)

// ⚠ 两个滚动键要在这里字面读一遍：`shared/scroll.ts` 写的是 `config?.autoScroll`，
//   可选链绕过了「死字段」闸的正则，那道闸会把这两个键判成声明了没人读
const scroll = computed(() =>
  readScrollSettings({
    autoScroll: props.config.autoScroll,
    scrollSpeed: props.config.scrollSpeed,
  }),
)

const title = computed(() => readText(props.config.title))

/** 配置里初始选中的那一页；用户点过之后由 `picked` 说了算。 */
const wantedTab = computed(() => readTrimmedText(props.config.defaultGroup))

const hold = createHoldStore()

/** 迟滞之后仍在场的行键。 */
const keptKeys = ref<readonly string[]>([])

/** 行键 → 告警起始时刻，`timeSource: 'alarmSince'` 那一档的时刻来源。 */
const sinceAt = ref<Readonly<Record<string, number>>>({})

// ⚠ 只留一个句柄：每次缝合都重设，不收回上一个就会攒出一串越跑越密的回调
let wakeTimer = 0

function clearWake(): void {
  if (wakeTimer === 0) return
  clearTimeout(wakeTimer)
  wakeTimer = 0
}

/** 按筛选与迟滞重算在场的行，并按最早的到期时刻续一次表。 */
function settle(): void {
  const active = rows.value
    .filter((row) => isRowKept(row, policy.value.filter))
    .map((row) => row.key)
  const result = hold.reconcile(active, Date.now(), policy.value.holdMs)
  keptKeys.value = result.entries.map((entry) => entry.key)
  sinceAt.value = sinceMap(result.entries)
  clearWake()
  if (result.nextWakeMs === null) return
  wakeTimer = window.setTimeout(settle, Math.max(0, result.nextWakeMs))
}

watch([rows, policy], settle, { immediate: true })

onBeforeUnmount(() => {
  clearWake()
  hold.dispose()
})

const visible = computed(() =>
  selectRows(rows.value, {
    keys: keptKeys.value,
    since: sinceAt.value,
    sort: policy.value.sort,
    timeSource: policy.value.timeSource,
  }),
)

/**
 * 这一行归到哪一段。
 * @param row 一行
 */
function groupOf(row: ListRow): string {
  return row.group === '' ? OTHER_GROUP : row.group
}

/**
 * 出现序的分组名与各自的行数。
 * ⚠ 计数用的是全量在场行而不是当前页签的子集：拿子集数，每个页签都会显示
 * 「自己那一份」的行数，看起来正常，实际上除了当前页签全是 0。
 */
const groups = computed(() => {
  const counts = new Map<string, number>()
  for (const row of visible.value) {
    const name = groupOf(row)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count }))
})

/** 用户点过的那一页；`null` = 还没点过，听配置的。 */
const picked = ref<string | null>(null)

/** 当前页签；指不到任何一个还在场的分组时看全部。 */
const activeTab = computed(() => {
  const wanted = picked.value ?? wantedTab.value
  return groups.value.some((group) => group.name === wanted) ? wanted : ALL_TAB
})

const tabs = computed(() => [
  { key: ALL_TAB, name: ALL_TAB_LABEL, count: visible.value.length },
  ...groups.value.map((group) => ({
    key: group.name,
    name: group.name,
    count: group.count,
  })),
])

/**
 * 切页签。
 * @param key 要选中的页签键
 */
function pickTab(key: string): void {
  picked.value = key
}

/** 摆到屏上的行：页签档只留当前页，其余档全留。 */
const shown = computed(() =>
  look.value.grouping === 'tabs' && activeTab.value !== ALL_TAB
    ? visible.value.filter((row) => groupOf(row) === activeTab.value)
    : visible.value,
)

const blocks = computed<RowBlock[]>(() => {
  const all = shown.value
  if (look.value.grouping !== 'section') {
    return [{ key: 'all', head: '', count: all.length, rows: all }]
  }
  const buckets = new Map<string, ListRow[]>()
  for (const row of all) {
    const bucket = buckets.get(groupOf(row))
    if (bucket === undefined) buckets.set(groupOf(row), [row])
    else bucket.push(row)
  }
  return [...buckets].map(([head, rows]) => ({
    key: head,
    head,
    count: rows.length,
    rows,
  }))
})

/**
 * 空态那一句话；还有行要画时是空串。
 * ⚠ 三档分开说：一行都没配、配了但一条都没命中筛选、以及绑了却一个读数都没回来。
 */
const emptyNote = computed(() =>
  readEmptyNote({
    config: props.config,
    rows: rows.value,
    shown: shown.value.length,
  }),
)
</script>

<template>
  <ModulePanel :title="title">
    <div class="il-list" :class="look.classes" :style="look.vars">
      <ul v-if="look.grouping === 'tabs'" class="il-tabs" role="tablist">
        <li
          v-for="tab in tabs"
          :key="tab.key"
          class="il-tab"
          :class="{ 'is-active': tab.key === activeTab }"
          role="tab"
          tabindex="0"
          :aria-selected="tab.key === activeTab"
          @click="pickTab(tab.key)"
          @keydown.enter.prevent="pickTab(tab.key)"
          @keydown.space.prevent="pickTab(tab.key)"
        >
          <span class="il-tab__name">{{ tab.name }}</span>
          <b class="il-tab__count">{{ tab.count }}</b>
        </li>
      </ul>
      <div v-if="look.header.show" class="il-head">
        <span class="il-head__cell">{{ look.header.name }}</span>
        <span class="il-head__cell">{{ look.header.value }}</span>
        <span class="il-head__cell">{{ look.header.unit }}</span>
      </div>
      <p v-if="emptyNote !== ''" class="il-empty">{{ emptyNote }}</p>
      <ScrollList
        v-else
        class="il-scroll"
        :item-count="shown.length"
        :auto-scroll="scroll.autoScroll"
        :seconds-per-item="scroll.scrollSpeed"
      >
        <template v-for="block in blocks" :key="block.key">
          <div v-if="block.head !== ''" class="il-section">
            <span class="il-section__name">{{ block.head }}</span>
            <b class="il-section__count">{{ block.count }}</b>
          </div>
          <InfoRow
            v-for="row in block.rows"
            :key="row.key"
            :row="row"
            :look="look"
            @pick="onPick"
          />
        </template>
      </ScrollList>
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
@use './variants';
</style>
