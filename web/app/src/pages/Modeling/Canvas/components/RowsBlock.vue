<script setup lang="ts">
/**
 * @fileoverview 行数的账：这一步动了多少行、谁的锅（规格 §4.3 的 `rows` 块）。
 *
 * ⚠ 漏斗按单位分组画：`ledger_source` 的六级里前三级数的是列、后三级数的是行，
 * 3 与 50,000 挤在一条轴上时前三级会缩成看不见的一丝。
 * ⚠ 配的比例与实际达成的比例一律两个都印：切分算子上两者不等是常事，只印一个
 * 就把「配了 5% 实际给了 10%」这件事整个藏了起来。
 */
import { DtNotice } from '@dt/ui'
import { computed } from 'vue'

import type { BarListItem } from '../scripts/barList'
import {
  LEDGER_LIMITS,
  blameOf,
  degradedReasonOf,
  groupStages,
  noticesOf,
  ratioPairOf,
  rowsSummary,
  stagesOf,
  type FunnelGroup,
} from '../scripts/ledgerBlocks'
import type { ReportBlock } from '../scripts/reportBlocks'
import { rowsOf } from '../scripts/reportBlocks'

import BarList from './BarList.vue'

const props = defineProps<{ block: ReportBlock }>()

const counts = computed(() => rowsOf(props.block.payload))
const notices = computed(() => noticesOf(props.block.payload))
const degraded = computed(() => degradedReasonOf(props.block.payload))
const stages = computed(() => stagesOf(counts.value.funnel))
const groups = computed(() => groupStages(stages.value))
const blame = computed(() => blameOf(counts.value.byColumn))
const ratios = computed(() => ratioPairOf(counts.value))
const summary = computed(() => rowsSummary(counts.value, blame.value))

/** 没有漏斗时至少画出前后两根条：那是这一块最起码要回答的问题。 */
const pairItems = computed<BarListItem[]>(() => [
  { name: '行数', before: counts.value.before, after: counts.value.after },
])

function stageItems(group: FunnelGroup): BarListItem[] {
  return group.stages.map((stage) => ({ name: stage.name, value: stage.value }))
}

/** 单位缺席时不编一个出来，只说这是逐级的账。 */
function groupLabel(group: FunnelGroup): string {
  return group.unit === '' ? '逐级' : `按${group.unit}数`
}

const blameItems = computed<BarListItem[]>(() =>
  blame.value.map((item) => ({ name: item.key, value: item.count })),
)

/** 拿不到的那几级各自说清为什么，不只印一个「—」（规格 §2-P4）。 */
const hints = computed(() =>
  stages.value
    .filter((stage) => stage.note !== '')
    .map((stage) => ({
      key: stage.name,
      text: `${stage.name}：${stage.note}`,
    })),
)

// ⚠ 只说「列到上限」不说「共 M 项」：payload 不带原始总数，M 只能编
const funnelCut = computed(() =>
  stages.value.length >= LEDGER_LIMITS.funnel
    ? `逐级账已经列到上限 ${LEDGER_LIMITS.funnel} 级，后面的几级没有带出来`
    : '',
)

const blameCut = computed(() =>
  blame.value.length >= LEDGER_LIMITS.blame
    ? `按列归因已经列到上限 ${LEDGER_LIMITS.blame} 列，摊得少的那些没有带出来`
    : '',
)
</script>

<template>
  <section class="dt-ml-rows">
    <h6 class="dt-ml-rows__title">{{ props.block.title }}</h6>
    <DtNotice
      v-for="text in notices.alerts"
      :key="text"
      intent="warning"
      icon="alert-triangle"
    >
      {{ text }}
    </DtNotice>
    <DtNotice v-if="degraded !== ''" intent="warning" icon="alert-triangle">
      {{ degraded }}
    </DtNotice>
    <dl v-if="ratios" class="dt-ml-rows__ratios">
      <dt>配的比例</dt>
      <dd>{{ ratios.configured }}</dd>
      <dt>实际达成</dt>
      <dd>{{ ratios.actual }}</dd>
    </dl>
    <p v-if="ratios?.isApart" class="dt-ml-rows__apart">
      两个数不一样，实际达成的才是这一步真给出去的
    </p>
    <div v-for="group in groups" :key="group.unit" class="dt-ml-rows__part">
      <p class="dt-ml-rows__label">{{ groupLabel(group) }}</p>
      <BarList :items="stageItems(group)" :unit="group.unit" />
    </div>
    <BarList v-if="groups.length === 0" :items="pairItems" mode="pairs" />
    <p v-if="funnelCut !== ''" class="dt-ml-rows__more">{{ funnelCut }}</p>
    <ul v-if="hints.length > 0" class="dt-ml-rows__hints">
      <li v-for="hint in hints" :key="hint.key">{{ hint.text }}</li>
    </ul>
    <div v-if="blameItems.length > 0" class="dt-ml-rows__part">
      <p class="dt-ml-rows__label">按列归因</p>
      <BarList :items="blameItems" unit="行" />
      <p v-if="blameCut !== ''" class="dt-ml-rows__more">{{ blameCut }}</p>
    </div>
    <p class="dt-ml-rows__read">{{ summary }}</p>
    <ul v-if="notices.notes.length > 0" class="dt-ml-rows__hints">
      <li v-for="text in notices.notes" :key="text">{{ text }}</li>
    </ul>
  </section>
</template>

<style scoped lang="scss">
.dt-ml-rows {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);

  &__title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
  }

  &__part {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  &__label {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  // 两个比例并排摆：读者要比的正是这两个数，隔开一段就比不出来了
  &__ratios {
    display: grid;
    grid-template-columns: max-content max-content;
    gap: 0.125rem 0.5rem;
    margin: 0;
    font-size: var(--ctl-hint-fs-sm);

    dt {
      color: var(--text-secondary);
    }

    dd {
      margin: 0;
      color: var(--text-title);
      font-family: var(--font-digit);
    }
  }

  &__apart {
    margin: 0;
    color: var(--state-warning);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__hints {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  // 图下那一行结论是给所有人的，不是 sr-only（规格 §2-P6）
  &__read {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__more {
    margin: 0;
    color: var(--state-warning);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
