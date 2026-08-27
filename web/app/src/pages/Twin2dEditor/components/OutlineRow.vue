<script setup lang="ts">
/**
 * @fileoverview 大纲里的一行：一枚类别图标、主名与副名两段，外加一枚小徽标。
 * 四段大纲共用这一副行，节点/连线/标注/样式各自只负责把自己的可辨识信息喂进来。
 *
 * ⚠ 行是 `<button>` 而不是 `role="option"` 的列表项：`role="listbox"` 在本轮的
 * `isFormFocused` 口径里算「可交互祖先」，套上去之后大纲一被点中，删除与方向键
 * 这些快捷键就整片让位给它——图还在，键按下去没反应，且这一步零报错。
 * ⚠ 主名与副名两段都要有：只画一个 id 的话，几十行大纲里认不出谁是谁，而这正是
 * 大纲存在的理由。
 */
import { DtIcon } from '@dt/ui'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 主名：显示名，没有显示名时退到 id。 */
    title: string
    /** 副名：样式名 / 两端 / 标注档位这类第二身份；空串即不画。 */
    note?: string
    /** 类别图标，取 `@dt/ui` 的登记名。 */
    icon: string
    /** 行尾的小徽标（节点自己的角标、样式的来历）；空串即不画。 */
    badge?: string
    /** 在不在当前那条选中轴上。 */
    selected?: boolean
    /** 副名是不是一句警告（样式悬空这类）。 */
    warn?: boolean
  }>(),
  { note: '', badge: '', selected: false, warn: false },
)

const emit = defineEmits<{
  /** 点了这一行；`additive` 为真表示按住了 Ctrl / ⌘。 */
  pick: [additive: boolean]
}>()

/** 悬浮提示把两段并起来：窄栏里主名与副名都会被截断。 */
const hint = computed(() =>
  props.note === '' ? props.title : `${props.title} · ${props.note}`,
)

/**
 * 点一行。
 * ⚠ 修饰键与画布上那一下同一条判据（`ctrlKey || metaKey`）：两处各判各的话，
 * 同一个手势在大纲里是加选、在画布上是顶替。
 * @param event 那一下点击
 */
function onClick(event: MouseEvent): void {
  emit('pick', event.ctrlKey || event.metaKey)
}
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-2xs hover:bg-accent-primary/10"
    :class="
      selected
        ? 'bg-accent-primary/10 text-accent-on-surface'
        : 'text-text-secondary'
    "
    :aria-pressed="selected"
    :title="hint"
    @click="onClick"
  >
    <DtIcon
      :name="icon"
      :size="12"
      :class="selected ? 'text-accent-primary' : 'text-text-disabled'"
    />
    <span class="flex min-w-0 flex-1 flex-col leading-tight">
      <span class="truncate">{{ title }}</span>
      <span
        v-if="note !== ''"
        class="truncate text-3xs"
        :class="warn ? 'text-state-warning' : 'text-text-disabled'"
        data-test="row-note"
        >{{ note }}</span
      >
    </span>
    <span
      v-if="badge !== ''"
      class="shrink-0 rounded border border-border-subtle px-1 text-3xs text-text-disabled"
      data-test="row-badge"
      >{{ badge }}</span
    >
  </button>
</template>
