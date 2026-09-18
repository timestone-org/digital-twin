<script setup lang="ts">
/** @fileoverview 左侧模型动画目录与保存前缺失清理提示。 */
import { missingAnimationNames } from '../scripts/missingAnimations'
import type { ModelAnimationEntry } from '@dt/three-core'
import type { TwinModelAnimations } from '@dt/twin-config'
import { DtIcon, DtInput } from '@dt/ui'
import { computed, ref, watch, onMounted, nextTick } from 'vue'
const props = defineProps<{
  clips: readonly ModelAnimationEntry[]
  config: TwinModelAnimations
  selected: string | null
  status?: string
}>()
const emit = defineEmits<{ select: [string] }>()
const root = ref<HTMLElement | null>(null)
const collapsed = ref(false)
async function reveal(): Promise<void> {
  collapsed.value = false
  query.value = ''
  await nextTick()
  const row = [
    ...(root.value?.querySelectorAll<HTMLElement>('[data-animation-name]') ??
      []),
  ].find((row) => row.dataset.animationName === props.selected)
  row?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}
watch(() => props.selected, reveal, { flush: 'post' })
onMounted(reveal)
defineExpose({ reveal })
const query = ref('')
function statusOf(
  clip: ModelAnimationEntry | undefined,
  mode: string | undefined,
): string {
  if (clip === undefined) return '模型中已缺失'
  if (clip.ambiguous) return '名称重复或为空'
  if (mode === 'point') return '点位控制'
  if (mode === 'always') return '固定播放'
  return mode === 'off' ? '已关闭' : '未单独配置'
}
const missing = computed(() =>
  missingAnimationNames(props.config, props.clips, props.status),
)
const rows = computed(() => {
  const names = [...new Set(props.clips.map((clip) => clip.name))]
  return names
    .map((name) => {
      const clip = props.clips.find((item) => item.name === name)
      const control = props.config.controls.find((item) => item.clip === name)
      const label = control?.name || name || '未命名动画'
      const status = statusOf(clip, control?.mode)

      return {
        name,
        label,
        status,
        duration: clip?.duration.toFixed(2) ?? '',
        disabled: clip?.ambiguous === true,
      }
    })
    .filter((row) =>
      `${row.name} ${row.label}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
    )
})
</script>
<template>
  <section ref="root" class="flex flex-col gap-1 pb-1" aria-label="模型动画">
    <div
      class="group sticky top-10 z-10 flex items-center gap-1 bg-surface-base px-1"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-2xs font-medium tracking-wider text-text-disabled hover:text-text-secondary"
        :aria-expanded="!collapsed"
        aria-label="展开或折叠模型动画"
        @click="collapsed = !collapsed"
      >
        <DtIcon
          :name="collapsed ? 'chevron-right' : 'chevron-down'"
          :size="12"
          class="shrink-0"
        />
        <span class="truncate">模型动画</span>
        <span class="text-3xs">{{ rows.length }}</span>
      </button>
    </div>
    <p
      v-if="missing.size > 0"
      role="alert"
      class="px-2 py-1 text-2xs text-state-warning"
    >
      {{ missing.size }}
      个动画已缺失，已隐藏，将在下次保存时移除对应配置和绑定。
    </p>
    <template v-if="!collapsed">
      <DtInput
        v-if="clips.length > 5"
        v-model="query"
        size="sm"
        placeholder="搜索动画"
        aria-label="搜索动画"
      />
      <div
        class="max-h-[min(40dvh,320px)] shrink-0 overflow-y-auto overscroll-contain"
      >
        <p
          v-if="rows.length === 0"
          class="px-4 py-0.5 text-2xs text-text-disabled"
        >
          {{
            clips.length === 0
              ? status === 'ready'
                ? '当前模型没有内置动画'
                : '等待模型加载动画目录'
              : '没有匹配的动画'
          }}
        </p>
        <button
          v-for="row in rows"
          :key="row.name"
          type="button"
          :data-animation-name="row.name"
          :aria-pressed="selected === row.name"
          :class="
            selected === row.name
              ? 'bg-accent-primary/15 text-accent-primary'
              : 'text-text-secondary hover:bg-surface-raised'
          "
          :disabled="row.disabled"
          class="flex w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] py-1 pl-[34px] pr-1 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40"
          @click="emit('select', row.name)"
        >
          <span class="flex min-w-0 flex-1 flex-col items-start text-left">
            <span class="max-w-full truncate" :title="row.name">{{
              row.label
            }}</span>
            <span class="py-0.5 text-2xs text-text-disabled"
              >{{ row.status }} {{ row.duration
              }}{{ row.duration ? ' 秒' : '' }}</span
            >
          </span>
        </button>
      </div>
    </template>
  </section>
</template>
