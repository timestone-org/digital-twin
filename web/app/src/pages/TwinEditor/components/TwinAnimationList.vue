<script setup lang="ts">
/** @fileoverview 左侧模型动画目录，保留失配配置以便重新绑定。 */
import type { ModelAnimationEntry } from '@dt/three-core'
import type { TwinModelAnimations } from '@dt/twin-config'
import { DtButton, DtInput } from '@dt/ui'
import { computed, ref, watch, onMounted } from 'vue'
const props = defineProps<{
  clips: readonly ModelAnimationEntry[]
  config: TwinModelAnimations
  selected: string | null
  status?: string
}>()
const emit = defineEmits<{ select: [string] }>()
const root = ref<HTMLElement | null>(null)
function reveal(): void {
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
const rows = computed(() => {
  const names = [
    ...new Set([
      ...props.clips.map((clip) => clip.name),
      ...props.config.controls.map((control) => control.clip),
    ]),
  ]
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
  <section
    ref="root"
    class="flex max-h-64 shrink-0 flex-col gap-2 border-b border-border-subtle p-2"
    aria-label="模型动画"
  >
    <h3 class="text-xs text-text-secondary">模型动画 · {{ clips.length }}</h3>
    <DtInput
      v-if="clips.length > 5"
      v-model="query"
      size="sm"
      placeholder="搜索动画"
      aria-label="搜索动画"
    />
    <div class="min-h-0 overflow-y-auto">
      <p v-if="rows.length === 0" class="text-xs text-text-disabled">
        {{
          clips.length === 0
            ? status === 'ready'
              ? '当前模型没有内置动画'
              : '等待模型加载动画目录'
            : '没有匹配的动画'
        }}
      </p>
      <DtButton
        v-for="row in rows"
        :key="row.name"
        :data-animation-name="row.name"
        size="sm"
        :variant="selected === row.name ? 'soft' : 'ghost'"
        :disabled="row.disabled"
        class="w-full"
        @click="emit('select', row.name)"
      >
        <span class="flex min-w-0 flex-1 flex-col items-start text-left">
          <span class="max-w-full truncate" :title="row.name">{{
            row.label
          }}</span>
          <span class="text-xs text-text-disabled"
            >{{ row.status }} {{ row.duration
            }}{{ row.duration ? ' 秒' : '' }}</span
          >
        </span>
      </DtButton>
    </div>
  </section>
</template>
