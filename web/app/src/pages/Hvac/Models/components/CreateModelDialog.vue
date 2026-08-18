<script setup lang="ts">
/**
 * @fileoverview 新建模型：选房间 → 按组合覆盖度勾服务组合 → 提交入队。
 *
 * ⚠ 选组合选的是**服务面**不是训练集：训练永远用房间全部可用事件，勾选决定
 * 页面重点评估哪些、试算默认给哪些（AC_MODEL_DESIGN §1）。文案要说清，
 * 不然用户会以为没勾的组合被扔掉了。
 * ⚠ 换房间会触发覆盖度取数，防竞态：慢的那次后返回会把勾选项刷成上一个
 * 房间的组合。
 */
import { computed, ref, watch } from 'vue'
import type { CombinationCoverage, Room } from '@dt/contracts'
import { MODEL_HALF_LIFE_DEFAULT_DAYS } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtField,
  DtInput,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtSelect,
} from '@dt/ui'

import { useFormDirty } from '@/composables/useFormDirty'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { formatSet } from '@/features/hvac/modelView'

const props = defineProps<{
  open: boolean
  rooms: readonly Room[]
  /** 打开时预填的房间；预填后仍可改，改了照常走覆盖度取数。 */
  roomId?: string | undefined
}>()

const emit = defineEmits<{
  close: []
  created: [modelId: string]
}>()

const coverageFetch = useRacedFetch()

const pickedRoom = ref('')
const name = ref('')
const description = ref('')
const halfLife = ref(MODEL_HALF_LIFE_DEFAULT_DAYS)
const isAdvancedOpen = ref(false)
const coverage = ref<CombinationCoverage[]>([])
const coverageError = ref<string | null>(null)
const picked = ref<Set<string>>(new Set())
const busy = ref(false)
const problem = ref<string | null>(null)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty(
  [pickedRoom, name, description, halfLife, picked],
  () => props.open,
)

const roomOptions = computed(() =>
  props.rooms
    .filter((room) => room.ac_unit_count > 0)
    .map((room) => ({
      value: room.id,
      label: `${room.workshop.name} · ${room.name}`,
    })),
)

/** 覆盖度里的组合选项；可用事件数直接标在名字后面。 */
const setOptions = computed(() =>
  coverage.value.map((item) => ({
    key: formatSet(item.running_set),
    label: `${formatSet(item.running_set)}（可用 ${item.usable_count} 条）`,
    set: item.running_set,
  })),
)

const canSubmit = computed(
  () =>
    pickedRoom.value !== '' &&
    name.value.trim() !== '' &&
    picked.value.size > 0 &&
    !busy.value,
)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    // ⚠ 重置成预填值而不是空串：写 '' 会把 roomId prop 的预填立刻抹掉
    pickedRoom.value = props.roomId ?? ''
    name.value = ''
    description.value = ''
    halfLife.value = MODEL_HALF_LIFE_DEFAULT_DAYS
    isAdvancedOpen.value = false
    problem.value = null
  },
)

// ⚠ 打开与换房间合成一条：只盯 roomId 的话，带着同一个预填房间第二次打开时
// 取值没变，覆盖度就永远停在「正在取…」
watch([() => props.open, pickedRoom], ([open, room]) => {
  coverage.value = []
  picked.value = new Set()
  coverageError.value = null
  if (!open || room === '') return
  void loadCoverage(room)
})

async function loadCoverage(room: string): Promise<void> {
  await coverageFetch.run(() => hvac.getStartupBatches(room), {
    ok: (batches) => {
      coverage.value = batches.coverage
      if (batches.current === null) {
        coverageError.value = '这个房间还没抽取过开机事件，先去开机事件页重算'
      }
    },
    fail: (caught) => {
      coverageError.value = describeError(caught)
    },
    settled: () => undefined,
  })
}

function toggle(key: string): void {
  const next = new Set(picked.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  picked.value = next
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  problem.value = null
  try {
    // 与后端口径一致：serial 升序
    const sets = setOptions.value
      .filter((option) => picked.value.has(option.key))
      .map((option) => [...option.set].sort())
    const model = await hvac.createAcModel({
      room_id: pickedRoom.value,
      name: name.value.trim(),
      ...(description.value.trim() === ''
        ? {}
        : { description: description.value.trim() }),
      serving_sets: sets,
      half_life_days: halfLife.value,
    })
    emit('created', model.id)
  } catch (caught) {
    problem.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="props.open"
    :dirty="isDirty"
    title="新建模型"
    description="一个房间一个模型；训练用房间的全部可用事件，勾选的组合是要重点评估与试算的那几个。"
    width="34rem"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtSelect
        v-model="pickedRoom"
        label="房间"
        :options="roomOptions"
        required
      />
      <DtInput v-model="name" label="模型名称" required maxlength="64" />

      <DtField label="服务组合" required>
        <DtNotice v-if="coverageError" intent="warning">
          {{ coverageError }}
        </DtNotice>
        <p v-else-if="pickedRoom === ''" class="text-xs text-text-secondary">
          先选房间，再从它抽出的组合里勾选。
        </p>
        <p
          v-else-if="setOptions.length === 0"
          class="text-xs text-text-secondary"
        >
          正在取组合覆盖度…
        </p>
        <div v-else class="flex max-h-48 flex-col gap-1 overflow-y-auto">
          <DtCheckbox
            v-for="option in setOptions"
            :key="option.key"
            :model-value="picked.has(option.key)"
            :label="option.label"
            @update:model-value="toggle(option.key)"
          />
        </div>
      </DtField>

      <DtInput
        v-model="description"
        label="描述"
        placeholder="可选"
        maxlength="200"
      />

      <button
        type="button"
        class="self-start text-xs text-text-secondary hover:text-text-primary"
        @click="isAdvancedOpen = !isAdvancedOpen"
      >
        {{ isAdvancedOpen ? '收起高级参数' : '高级参数…' }}
      </button>
      <DtNumberInput
        v-if="isAdvancedOpen"
        v-model="halfLife"
        label="样本半衰期（天）"
        hint="老样本每过一个半衰期权重减半；季节差异由特征承担，不靠丢老数据"
        :range="{ min: 7, max: 3650 }"
      />

      <DtNotice v-if="problem" intent="danger">
        {{ problem }}
      </DtNotice>
    </div>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="emit('close')">
        取消
      </DtButton>
      <DtButton
        intent="primary"
        :disabled="!canSubmit"
        :loading="busy"
        @click="submit"
      >
        建模并训练
      </DtButton>
    </template>
  </DtModal>
</template>
