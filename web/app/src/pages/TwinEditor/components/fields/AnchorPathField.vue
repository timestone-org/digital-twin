<script setup lang="ts">
/**
 * @fileoverview 能量流的路径：按顺序挑一串锚点，可增删、可调序、可重复选同一个。
 *
 * ⚠ 少于两个可解析的点画不出线：渲染层对这种流是**整条不画**，问题由
 * `collectTwinConfigIssues` 的 `flow-too-short` 报出来。所以面板上必须当场说，
 * 否则用户看到的是「配了一条流，画面上什么都没有」。
 */
import type { TwinAnchor } from '@dt/twin-config'
import { DtButton, DtIcon, DtNotice, DtSelect } from '@dt/ui'
import { computed, ref } from 'vue'

const props = defineProps<{
  modelValue: readonly string[]
  anchors: readonly TwinAnchor[]
}>()

const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

/** 待添加的锚点；空串 = 还没选过，按下拉第一项算。 */
const pending = ref('')

/** 锚点没名字时退回「锚点 N」：一行没有任何标识比显示 id 更难认。 */
function nameOf(anchor: TwinAnchor, index: number): string {
  const name = anchor.name.trim()
  return name === '' ? `锚点 ${index + 1}` : name
}

const anchorOptions = computed(() =>
  props.anchors.map((anchor, index) => ({
    value: anchor.id,
    label: nameOf(anchor, index),
  })),
)

// 选中项跟着列表走：pending 空着（或指向已删掉的锚点）时落到第一项
const picked = computed(() => {
  const chosen = anchorOptions.value.find(
    (option) => option.value === pending.value,
  )
  return chosen?.value ?? anchorOptions.value[0]?.value ?? ''
})

/** 路径上的一段：第几站、显示名，以及它是不是指到了不存在的锚点。 */
interface PathStop {
  /** ⚠ 同一个锚点允许在路径里出现多次，所以行 key 必须带上位置。 */
  key: string
  index: number
  label: string
  missing: boolean
}

const stops = computed<PathStop[]>(() =>
  props.modelValue.map((id, index) => {
    const at = props.anchors.findIndex((anchor) => anchor.id === id)
    const anchor = props.anchors[at]
    return {
      key: `${id}@${index}`,
      index,
      label: anchor === undefined ? `找不到锚点 ${id}` : nameOf(anchor, at),
      missing: anchor === undefined,
    }
  }),
)

/** 能解析出坐标的站数；画不画得出线只看它。 */
const resolved = computed(
  () => stops.value.filter((stop) => !stop.missing).length,
)

function write(next: string[]): void {
  emit('update:modelValue', next)
}

function add(): void {
  if (picked.value === '') return
  write([...props.modelValue, picked.value])
}

function removeAt(index: number): void {
  write(props.modelValue.filter((_, at) => at !== index))
}

/**
 * 挪动一站。
 * @param index 当前位置
 * @param delta -1 上移，1 下移
 */
function move(index: number, delta: number): void {
  const to = index + delta
  const next = [...props.modelValue]
  const moved = next[index]
  if (to < 0 || to >= next.length || moved === undefined) return
  next.splice(index, 1)
  next.splice(to, 0, moved)
  write(next)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="stop in stops"
      :key="stop.key"
      class="flex items-center gap-1 rounded border border-border-subtle bg-surface-sunken px-1.5 py-1"
    >
      <span class="w-4 shrink-0 text-center text-xs text-text-disabled">
        {{ stop.index + 1 }}
      </span>
      <span
        class="min-w-0 flex-1 truncate text-xs"
        :class="stop.missing ? 'text-state-danger' : 'text-text-primary'"
      >
        {{ stop.label }}
      </span>
      <button
        type="button"
        class="text-text-secondary hover:text-accent-primary disabled:text-text-disabled"
        :disabled="stop.index === 0"
        aria-label="上移路径点"
        title="上移路径点"
        @click="move(stop.index, -1)"
      >
        <DtIcon name="chevron-up" :size="13" />
      </button>
      <button
        type="button"
        class="text-text-secondary hover:text-accent-primary disabled:text-text-disabled"
        :disabled="stop.index === stops.length - 1"
        aria-label="下移路径点"
        title="下移路径点"
        @click="move(stop.index, 1)"
      >
        <DtIcon name="chevron-down" :size="13" />
      </button>
      <button
        type="button"
        class="text-text-disabled hover:text-state-danger"
        aria-label="移除路径点"
        title="移除路径点"
        @click="removeAt(stop.index)"
      >
        <DtIcon name="trash" :size="13" />
      </button>
    </div>

    <p v-if="anchors.length === 0" class="text-xs text-text-disabled">
      场景里还没有锚点，先加锚点再连能量流。
    </p>
    <div v-else class="grid grid-cols-[1fr_auto] gap-1.5">
      <DtSelect
        :model-value="picked"
        :options="anchorOptions"
        aria-label="要添加的锚点"
        size="sm"
        @update:model-value="pending = $event"
      />
      <DtButton variant="soft" size="sm" icon="plus" @click="add"
        >添加</DtButton
      >
    </div>

    <DtNotice v-if="resolved < 2" intent="warning" icon="alert-triangle">
      可解析的路径点不足两个，这条流画不出来——一条线至少要两站。
    </DtNotice>
    <p class="text-xs text-text-disabled">
      同一个锚点可以重复出现（往返、回环都靠它）。
    </p>
  </div>
</template>
