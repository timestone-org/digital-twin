<script setup lang="ts">
/**
 * @fileoverview DtDateTimeInput 的日历面板：月格 + 时分。
 *
 * 进出都是**本地时**的 `YYYY-MM-DDTHH:mm`，UTC 换算留在外层组件一处做——
 * 面板自己再换一次的话，两处口径迟早会分叉，而症状是整批查询差一个时区。
 */
import { computed, ref } from 'vue'
import type { DtSize } from '@dt/contracts'
import DtSelect from '../DtSelect/DtSelect.vue'
import DtIcon from '../DtIcon/DtIcon.vue'
import type { MonthCursor } from '../../shared/calendar'
import {
  clampLocal,
  cursorOf,
  currentCursor,
  hourOptions,
  isDaySelectable,
  joinLocalMinute,
  minuteOptions,
  monthCells,
  shiftMonth,
  splitLocalMinute,
} from '../../shared/calendar'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const props = withDefaults(
  defineProps<{
    /** 当前取值，本地时的 `YYYY-MM-DDTHH:mm`；空串表示还没选。 */
    value: string
    min: string
    max: string
    size?: DtSize | undefined
  }>(),
  { size: 'sm' },
)

const emit = defineEmits<{ pick: [local: string] }>()

// 翻月只改「正在看哪一月」，不动取值；没翻过就跟着取值走，取值也没有才落在当月
const thisMonth = currentCursor()
const browsing = ref<MonthCursor | null>(null)
const cursor = computed(
  () => browsing.value ?? cursorOf(props.value) ?? thisMonth,
)

function goMonth(delta: number): void {
  browsing.value = shiftMonth(cursor.value, delta)
}

const parts = computed(() => splitLocalMinute(props.value))
const hour = computed(() => parts.value?.hour ?? 0)
const minute = computed(() => parts.value?.minute ?? 0)
const title = computed(() => `${cursor.value.year} 年 ${cursor.value.month} 月`)
const cells = computed(() => monthCells(cursor.value))

/** 选中的那一天要高亮，但只在它就在当前翻到的这个月时。 */
const activeDay = computed(() => {
  const found = parts.value
  if (found === null) return 0
  const sameMonth =
    found.year === cursor.value.year && found.month === cursor.value.month
  return sameMonth ? found.day : 0
})

function emitAt(day: number, nextHour: number, nextMinute: number): void {
  const local = joinLocalMinute({
    ...cursor.value,
    day,
    hour: nextHour,
    minute: nextMinute,
  })
  emit('pick', clampLocal(local, props.min, props.max))
}

function pickDay(day: number): void {
  emitAt(day, hour.value, minute.value)
}

/** 还没选过日子时，改时分就落在当前翻到这个月的 1 号。 */
function pickTime(nextHour: number, nextMinute: number): void {
  emitAt(parts.value?.day ?? 1, nextHour, nextMinute)
}

function labelOf(day: number): string {
  return `${cursor.value.year} 年 ${cursor.value.month} 月 ${day} 日`
}
</script>

<template>
  <div class="dt-calendar">
    <div class="dt-calendar__bar">
      <button
        type="button"
        class="dt-calendar__nav"
        aria-label="上个月"
        @click="goMonth(-1)"
      >
        <DtIcon name="chevron-left" :size="14" />
      </button>
      <span class="dt-calendar__title" aria-live="polite">{{ title }}</span>
      <button
        type="button"
        class="dt-calendar__nav"
        aria-label="下个月"
        @click="goMonth(1)"
      >
        <DtIcon name="chevron-right" :size="14" />
      </button>
    </div>

    <div class="dt-calendar__grid" role="grid" aria-label="选择日期">
      <span
        v-for="name in WEEKDAYS"
        :key="name"
        class="dt-calendar__weekday"
        aria-hidden="true"
      >
        {{ name }}
      </span>
      <template v-for="cell in cells" :key="cell.key">
        <span v-if="cell.day === null" class="dt-calendar__blank" />
        <button
          v-else
          type="button"
          class="dt-calendar__day"
          :class="{ 'is-active': cell.day === activeDay }"
          :aria-label="labelOf(cell.day)"
          :aria-pressed="cell.day === activeDay"
          :disabled="!isDaySelectable(cursor, cell.day, min, max)"
          @click="pickDay(cell.day)"
        >
          {{ cell.day }}
        </button>
      </template>
    </div>

    <div class="dt-calendar__time">
      <DtSelect
        :model-value="String(hour)"
        :size="size"
        aria-label="小时"
        :options="hourOptions()"
        @update:model-value="pickTime(Number($event), minute)"
      />
      <span class="dt-calendar__colon">:</span>
      <DtSelect
        :model-value="String(minute)"
        :size="size"
        aria-label="分钟"
        :options="minuteOptions()"
        @update:model-value="pickTime(hour, Number($event))"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-calendar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 15rem;

  &__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: var(--ctl-fs-sm);
    color: var(--text-primary);
  }

  &__nav {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--ctl-box-md);
    height: var(--ctl-box-md);
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;

    &:hover {
      background: rgba(var(--neutral-fg-rgb), 0.12);
      color: var(--text-primary);
    }
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }

  &__weekday {
    text-align: center;
    font-size: var(--ctl-hint-fs-sm);
    color: var(--text-disabled);
  }

  &__blank {
    display: block;
  }

  &__day {
    padding: 4px 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--ctl-fs-sm);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: rgba(var(--accent-primary-rgb), 0.16);
    }

    &.is-active {
      background: var(--accent-primary);
      color: var(--text-on-emphasis);
    }

    &:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
  }

  &__time {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  &__colon {
    color: var(--text-secondary);
  }
}
</style>
