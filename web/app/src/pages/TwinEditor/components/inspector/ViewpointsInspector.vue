<script setup lang="ts">
/**
 * @fileoverview 视点切换控件检查器：开关、形态、键盘切换与要显示哪几个视点。
 *
 * ⚠ `items` 空数组 = 按视点的文档序**全部显示**，不是「一个都不显示」。
 * 要一个都不显示得关掉整个控件，所以界面上把这两档分成两个东西，
 * 并在清单被勾空时直说它已经退回「全部显示」。
 * ⚠ `items` 里挑到不存在的视点会静默不显示，所以只许从 `cameras` 里勾，
 * 不给手填；删过视点留下的悬空 id 单独报出来。
 */
import {
  TWIN_VIEWPOINT_MODES,
  type TwinCamera,
  type TwinViewpointMode,
  type TwinViewpointSwitcher,
} from '@dt/twin-config'
import { DtButton, DtCheckbox, DtSegmented, DtSwitch } from '@dt/ui'
import { computed } from 'vue'

import InspectorSection from '../fields/InspectorSection.vue'

const props = defineProps<{
  modelValue: TwinViewpointSwitcher
  cameras: readonly TwinCamera[]
}>()

const emit = defineEmits<{ 'update:modelValue': [TwinViewpointSwitcher] }>()

const MODE_LABELS: Readonly<Record<TwinViewpointMode, string>> = {
  buttons: '按钮排',
  dropdown: '下拉',
}

const modeOptions = TWIN_VIEWPOINT_MODES.map((value) => ({
  value,
  label: MODE_LABELS[value],
}))

/** 勾中的视点，按 `items` 的顺序；`items` 里不存在的 id 在这里被滤掉。 */
const picked = computed(() =>
  props.modelValue.items
    .map((id) => props.cameras.find((camera) => camera.id === id))
    .filter((camera): camera is TwinCamera => camera !== undefined),
)

/** 指向已删视点的 id 个数；它们在运行态什么都不显示，得说出来。 */
const dangling = computed(
  () => props.modelValue.items.length - picked.value.length,
)

/** 勾中的在前（按显示序），没勾的排后面。 */
const rows = computed(() => {
  const pickedIds = new Set(picked.value.map((camera) => camera.id))
  const rest = props.cameras.filter((camera) => !pickedIds.has(camera.id))
  return [
    ...picked.value.map((camera, order) => ({ camera, order })),
    ...rest.map((camera) => ({ camera, order: -1 })),
  ]
})

const showAll = computed(() => props.modelValue.items.length === 0)

function write(patch: Partial<TwinViewpointSwitcher>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeMode(next: string): void {
  const mode = TWIN_VIEWPOINT_MODES.find((item) => item === next)
  if (mode !== undefined) write({ mode })
}

/** 打开 = 清空清单（全显示）；关掉 = 把当前所有视点铺进清单，再由用户去勾。 */
function toggleShowAll(all: boolean): void {
  write({ items: all ? [] : props.cameras.map((camera) => camera.id) })
}

function toggleItem(id: string, on: boolean): void {
  const items = on
    ? [...props.modelValue.items, id]
    : props.modelValue.items.filter((item) => item !== id)
  write({ items })
}

/**
 * 在清单里挪一位。⚠ 顺序就是运行态的显示序，不只是这张表的排版。
 *
 * ⚠ 只交换两个**现存**视点占的位置，不许按可见清单整份重写 `items`：那样会把
 * 指向已删视点的悬空 id 顺手抹掉，上面那句「有 N 个视点已经被删掉了」也跟着
 * 消失——用户只是点了一下上移，却在毫无提示的情况下丢掉了一条待处理的记录。
 * 悬空引用一律留着由诊断报出来，这里与删实体的口径一致。
 */
function move(order: number, delta: number): void {
  const items = [...props.modelValue.items]
  const liveIndexes = items
    .map((id, index) => ({ id, index }))
    .filter((entry) => props.cameras.some((camera) => camera.id === entry.id))
  const from = liveIndexes[order]
  const to = liveIndexes[order + delta]
  if (from === undefined || to === undefined) return
  items[from.index] = to.id
  items[to.index] = from.id
  write({ items })
}

function nameOf(camera: TwinCamera): string {
  return camera.name === '' ? '未命名视点' : camera.name
}
</script>

<template>
  <div class="flex flex-col">
    <InspectorSection title="视点切换">
      <DtSwitch
        :model-value="modelValue.enabled"
        label="大屏上显示切换控件"
        size="sm"
        @update:model-value="write({ enabled: $event })"
      />
      <template v-if="modelValue.enabled">
        <DtSegmented
          :model-value="modelValue.mode"
          :options="modeOptions"
          aria-label="控件形态"
          size="sm"
          block
          @update:model-value="writeMode"
        />
        <DtSwitch
          :model-value="modelValue.keyboard"
          label="数字键与方向键也能切"
          size="sm"
          @update:model-value="write({ keyboard: $event })"
        />
      </template>
    </InspectorSection>

    <InspectorSection title="显示哪些视点">
      <DtSwitch
        :model-value="showAll"
        label="全部显示（按视点列表的顺序）"
        size="sm"
        @update:model-value="toggleShowAll"
      />

      <p v-if="showAll" class="text-xs text-text-disabled">
        清单为空 =
        按视点列表的文档序全部显示。这里没有「一个都不显示」这一档，要整个藏起来请关掉上面的切换控件。
      </p>

      <template v-else>
        <p v-if="cameras.length === 0" class="text-xs text-text-disabled">
          还没有视点，先去大纲树里加一个。
        </p>
        <ul v-else class="flex flex-col gap-1">
          <li
            v-for="row in rows"
            :key="row.camera.id"
            class="flex min-w-0 items-center gap-1.5 rounded-sm border border-border-subtle px-2 py-1"
          >
            <DtCheckbox
              :model-value="row.order >= 0"
              class="min-w-0 flex-1"
              @update:model-value="toggleItem(row.camera.id, $event)"
            >
              <span class="min-w-0 flex-1 truncate text-xs">
                {{ nameOf(row.camera) }}
              </span>
            </DtCheckbox>
            <DtButton
              variant="ghost"
              size="sm"
              icon="chevron-up"
              :disabled="row.order <= 0"
              :aria-label="`上移 ${nameOf(row.camera)}`"
              @click="move(row.order, -1)"
            />
            <DtButton
              variant="ghost"
              size="sm"
              icon="chevron-down"
              :disabled="row.order < 0 || row.order >= picked.length - 1"
              :aria-label="`下移 ${nameOf(row.camera)}`"
              @click="move(row.order, 1)"
            />
          </li>
        </ul>
        <p class="text-xs text-text-disabled">
          勾掉最后一个会让清单变空，那等于回到「全部显示」。
        </p>
      </template>

      <p v-if="dangling > 0" class="text-xs text-state-warning">
        清单里有 {{ dangling }} 个视点已经被删掉了，运行态不会显示它们。
      </p>
    </InspectorSection>
  </div>
</template>
