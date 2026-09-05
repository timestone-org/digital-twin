<script setup lang="ts">
/**
 * @fileoverview 列的账：列去哪了、多出来的是谁造的（规格 §4.3 的 `columns` 块）。
 *
 * ⚠ 两组名单默认折叠：`one_hot` 与 `lag_feature` 一次能造出几十个列名，铺开会把
 * 这一区顶到半屏高，而下面几区才是这一步真正的结论。
 * ⚠ `reason` 照实印、一个字不改写：它是后端把参数与实际取值算完之后的那句话，
 * 前端改写等于把「在 5 行训练行上打分」说成别的。
 */
import { DtNotice, DtTooltip } from '@dt/ui'
import { computed } from 'vue'

import {
  LEDGER_LIMITS,
  columnsSummary,
  degradedReasonOf,
  dtypesOf,
  noticesOf,
} from '../scripts/ledgerBlocks'
import type { ReportBlock } from '../scripts/reportBlocks'
import { columnsOf } from '../scripts/reportBlocks'

const props = defineProps<{ block: ReportBlock }>()

/** 名单短到这个数以内就摊开：折起来反而多一次点击。 */
const OPEN_UNDER = 8

const change = computed(() => columnsOf(props.block.payload))
const notices = computed(() => noticesOf(props.block.payload))
const degraded = computed(() => degradedReasonOf(props.block.payload))
const dtypes = computed(() => dtypesOf(change.value.dtypeBefore))
const summary = computed(() => columnsSummary(change.value, dtypes.value))

interface NameList {
  readonly kind: string
  readonly label: string
  readonly names: readonly string[]
  readonly isOpen: boolean
  readonly cut: string
}

// ⚠ 只说「列到上限」不说「共 M 列」：payload 不带原始总数，M 只能编
function cutOf(names: readonly string[]): string {
  return names.length >= LEDGER_LIMITS.names
    ? `名单已经列到上限 ${LEDGER_LIMITS.names} 个，后面的列名没有带出来`
    : ''
}

function listOf(
  kind: string,
  label: string,
  names: readonly string[],
): NameList {
  return {
    kind,
    label: `${label} ${names.length} 列`,
    names,
    isOpen: names.length <= OPEN_UNDER,
    cut: cutOf(names),
  }
}

const lists = computed<NameList[]>(() =>
  [
    listOf('added', '新增', change.value.added),
    listOf('removed', '移除', change.value.removed),
  ].filter((one) => one.names.length > 0),
)

const dtypeCut = computed(() =>
  dtypes.value.length >= LEDGER_LIMITS.dtypes
    ? `类型对照已经列到上限 ${LEDGER_LIMITS.dtypes} 列，后面的没有带出来`
    : '',
)
</script>

<template>
  <section class="dt-ml-cols">
    <h6 class="dt-ml-cols__title">{{ props.block.title }}</h6>
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
    <p v-if="change.reason !== ''" class="dt-ml-cols__reason">
      {{ change.reason }}
    </p>
    <details
      v-for="list in lists"
      :key="list.kind"
      class="dt-ml-cols__list"
      :open="list.isOpen"
    >
      <summary>{{ list.label }}</summary>
      <ul class="dt-ml-cols__names">
        <li v-for="name in list.names" :key="name">
          <DtTooltip class="dt-ml-cols__name" :content="name">
            <span class="dt-ml-cols__text">{{ name }}</span>
          </DtTooltip>
        </li>
      </ul>
      <p v-if="list.cut !== ''" class="dt-ml-cols__more">{{ list.cut }}</p>
    </details>
    <div v-if="dtypes.length > 0" class="dt-ml-cols__part">
      <p class="dt-ml-cols__label">换过类型的列</p>
      <ul class="dt-ml-cols__types">
        <li v-for="one in dtypes" :key="one.key">
          <DtTooltip class="dt-ml-cols__name" :content="one.key">
            <span class="dt-ml-cols__text">{{ one.key }}</span>
          </DtTooltip>
          <span class="dt-ml-cols__cast">{{ one.cast }}</span>
        </li>
      </ul>
      <p v-if="dtypeCut !== ''" class="dt-ml-cols__more">{{ dtypeCut }}</p>
    </div>
    <p class="dt-ml-cols__read">{{ summary }}</p>
    <ul v-if="notices.notes.length > 0" class="dt-ml-cols__hints">
      <li v-for="text in notices.notes" :key="text">{{ text }}</li>
    </ul>
  </section>
</template>

<style scoped lang="scss">
.dt-ml-cols {
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

  &__reason,
  &__label {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__part {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  &__list {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__names {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
  }

  &__types {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--ctl-hint-fs-sm);

    li {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
    }
  }

  // 长中文列名统一口径：12rem 省略号，全名走 DtTooltip（规格 §7 末）
  // ⚠ 省略号必须落在里面这层：DtTooltip 的根是 inline-flex，文字在它上面是匿名
  // 弹性项，`text-overflow` 管不着
  &__name {
    max-width: 12rem;
    min-width: 0;
  }

  &__text {
    overflow: hidden;
    max-width: 12rem;
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-title);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__cast {
    color: var(--text-secondary);
    font-family: var(--font-digit);
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
    margin: 0.25rem 0 0;
    color: var(--state-warning);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
