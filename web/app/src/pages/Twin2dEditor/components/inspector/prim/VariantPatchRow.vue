<script setup lang="ts">
/**
 * @fileoverview 一条变体里针对**一枚图元**的覆盖：上面一行是它盖住了哪几格（点一下就
 * 撤掉那一格），下面是这枚图元被盖过之后的样子——改哪一格，哪一格就进补丁。
 *
 * ⚠ 编的是**盖过之后的样子**而不是补丁本身：补丁是「与样式里那一枚的差」，让用户
 *   直接改效果、由这里去算差，比让他先想清楚「要覆盖哪几个键」再逐格填要短一大截，
 *   也不会出现「覆盖了但值和原来一样」这种自己看不出来的白覆盖。
 * ⚠ 差是**按引用**比的：控件改一格出一个新对象，没碰过的键连引用都不换（浅展开），
 *   所以只有真被改到的键会进补丁。已经在补丁里的键即使被改回原值也留着，撤掉它只能
 *   点上面那一行——不然「改回去」与「不覆盖」在界面上分不出来。
 * ⚠ 预览借的是渲染层那一份浅合并（`applyVariants`），不在这里另抄一遍：抄的那份一旦
 *   与它漂开，同一条补丁在编辑器与画面上就是两个样子，而两边都不报错。
 * ⚠ `id` / `kind` / `children` 进不了补丁，这一条由 `normalizePrimPatch` 兜住，
 *   不在这里另抄一份名单。
 * ⚠ 指向的图元已经不在时当场标红（`dangling-variant-prim`）：那一条补丁永远不会生效，
 *   而界面上它看着与别的一模一样。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { applyVariants, normalizePrimPatch } from '@dt/twin2d'
import type {
  Twin2dCondition,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dState,
  Twin2dVariant,
  Twin2dVariantCtx,
} from '@dt/twin2d'
import { DtButton } from '@dt/ui'
import { computed } from 'vue'

import PrimFields from '../PrimFields.vue'

const props = defineProps<{
  /** 被覆盖的图元 id。 */
  primId: string
  /** 样式里那一枚图元；null = 这个 id 已经指空了。 */
  base: Twin2dPrim | null
  patch: Twin2dPrimPatch
}>()

const emit = defineEmits<{
  update: [patch: Twin2dPrimPatch]
  remove: []
  blur: []
}>()

/** 预览用的那条假变体：条件恒成立，只为借渲染层那一份浅合并。 */
const PREVIEW_WHEN: Twin2dCondition = { kind: 'state', state: 'hover' }

/** 预览上下文：只把上面那条条件所需的交互态打开，别的一概不给。 */
const PREVIEW_CTX: Twin2dVariantCtx = {
  states: new Set<Twin2dState>(['hover']),
  status: null,
  tags: new Map<string, string>(),
  slots: new Map<string, unknown>(),
  fields: new Map(),
}

/** 指空了的说明。 */
const DANGLING = '样式里没有这枚图元，这条覆盖永远不会生效'

/**
 * 补丁每一格的中文名。
 * ⚠ 写成 `Record<keyof Twin2dPrimPatch, …>`：契约里新加一个可补丁键而这里漏了名字，
 * 编译期就红，不会等到界面上冒出一个英文键名。
 */
const KEY_LABELS: Readonly<Record<keyof Twin2dPrimPatch, string>> = {
  at: '摆位',
  size: '尺寸',
  minWidth: '最小宽',
  maxWidth: '最大宽',
  z: '层号',
  opacity: '不透明度',
  hidden: '藏起来',
  when: '渲染条件',
  anim: '循环动画',
  transition: '过渡',
  rotate: '旋转',
  scale: '等比缩放',
  transformOrigin: '变换基点',
  pointerEvents: '指针事件',
  keepUpright: '保持正立',
  layout: '排布',
  fills: '填充',
  border: '边框',
  radius: '圆角',
  shadows: '阴影',
  backdropBlur: '背板模糊',
  clip: '裁剪',
  cursor: '光标',
  coord: '坐标口径',
  shape: '几何',
  fill: '上色',
  strokes: '描边',
  gradients: '局部渐变',
  stretch: '拉伸填满',
  src: '来源',
  color: '颜色',
  font: '字体',
  lineHeight: '行高',
  align: '横向对齐',
  baseline: '基线',
  nowrap: '不换行',
  ellipsis: '省略号',
  titleAttr: '悬浮全文',
  outline: '描边字',
}

/** 这条补丁盖住的那几格，顺序取上面那张表的顺序（= 稳定，不随写入先后跳）。 */
const covered = computed(() =>
  Object.entries(KEY_LABELS)
    .filter(([key]) => key in props.patch)
    .map(([key, label]) => ({ key, label })),
)

/** 这枚图元被盖过之后的样子；指空了就没得编。 */
const effective = computed<Twin2dPrim | null>(() => {
  const base = props.base
  if (base === null) return null
  const variant: Twin2dVariant = {
    id: props.primId,
    when: PREVIEW_WHEN,
    patch: { [props.primId]: props.patch },
    rootPatch: {},
  }
  return applyVariants([base], [variant], PREVIEW_CTX).prims[0] ?? base
})

/**
 * 改完之后：按引用比出被改到的那几格，连同已经在补丁里的一起交出去。
 * @param next 盖过之后那一枚的新样子
 */
function onEdited(next: Twin2dPrim): void {
  const base = props.base
  if (base === null) return
  const was: Record<string, unknown> = { ...base }
  const now: Record<string, unknown> = { ...next }
  const raw: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(now)) {
    if (key in props.patch || was[key] !== value) raw[key] = value
  }
  emit('update', normalizePrimPatch(raw))
}

/**
 * 撤掉一格覆盖。
 * ⚠ 删键而不是写一个缺省值进去：浅覆盖里「不覆盖」与「覆盖成缺省值」是两回事。
 * @param key 要撤掉的那一格
 */
function clearKey(key: string): void {
  const kept = Object.entries(props.patch).filter(([one]) => one !== key)
  emit('update', normalizePrimPatch(Object.fromEntries(kept)))
}
</script>

<template>
  <div
    class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
    :data-test="`vpatch-row-${primId}`"
  >
    <div class="flex items-center gap-1">
      <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
        覆盖 {{ primId }}
      </span>
      <DtButton
        size="xs"
        variant="ghost"
        intent="danger"
        icon="trash"
        aria-label="撤掉整条覆盖"
        title="撤掉整条覆盖"
        :data-test="`vpatch-remove-${primId}`"
        @click="emit('remove')"
      />
    </div>

    <p
      v-if="base === null"
      class="text-xs text-state-danger"
      :data-test="`vpatch-dangling-${primId}`"
    >
      {{ DANGLING }}
    </p>

    <div v-if="covered.length > 0" class="flex flex-wrap gap-1">
      <DtButton
        v-for="one in covered"
        :key="one.key"
        size="xs"
        variant="soft"
        intent="neutral"
        icon="close"
        :title="`撤掉「${one.label}」这一格`"
        :data-test="`vpatch-clear-${primId}-${one.key}`"
        @click="clearKey(one.key)"
      >
        {{ one.label }}
      </DtButton>
    </div>

    <p v-else class="text-xs text-text-disabled">
      还没盖住任何一格：下面改哪一格，哪一格就进这条覆盖。
    </p>

    <PrimFields
      v-if="effective !== null"
      :model-value="effective"
      @update:model-value="onEdited"
      @blur="emit('blur')"
    />
  </div>
</template>
