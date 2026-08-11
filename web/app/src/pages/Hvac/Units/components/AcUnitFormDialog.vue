<script setup lang="ts">
/**
 * @fileoverview 建档 / 改空调弹窗。
 * ⚠ 车间与房间都是必选：空调不允许处于没有归属的中间态，后端 `room_id`
 * NOT NULL。没有房间可选时给的是「先去空间配置建房间」这条出路，而不是
 * 让人对着一个空下拉框反复点。
 */
import { computed, ref, watch } from 'vue'
import type { AcUnit } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtSelect } from '@dt/ui'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import { useLocationPicker } from '@/features/hvac/useLocationPicker'

const props = defineProps<{
  modelValue: boolean
  unit: AcUnit | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [message: string]
}>()

// 解构出来的是 ref 本身，模板里直接用；整包传进模板要写一串 `.value`
const {
  workshopId,
  roomId,
  rooms,
  workshopOptions,
  roomOptions,
  loadWorkshops,
  select,
} = useLocationPicker()
const serial = ref('')
const name = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const isEdit = computed(() => props.unit !== null)
const canSubmit = computed(
  () =>
    serial.value.trim() !== '' &&
    name.value.trim() !== '' &&
    roomId.value !== '',
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = null
    serial.value = props.unit?.serial ?? ''
    name.value = props.unit?.name ?? ''
    void loadWorkshops()
    select(props.unit?.workshop.id ?? '', props.unit?.room.id ?? '')
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载（深链、或标记与挂载同一 tick）
  // 时，只监听变化的 watch 一次都不会跑，表单会是空的。
  { immediate: true },
)

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  error.value = null
  try {
    await save()
    emit('update:modelValue', false)
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}

async function save(): Promise<void> {
  const payload = {
    serial: serial.value.trim(),
    name: name.value.trim(),
    room_id: roomId.value,
  }
  if (props.unit === null) {
    await hvac.createAcUnit(payload)
    emit('saved', '空调已建档')
    return
  }
  await hvac.updateAcUnit(props.unit.id, payload)
  emit('saved', '空调已更新')
}
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    :title="isEdit ? '编辑空调' : '新建空调'"
    description="序号是全场唯一的设备编号，不是排序号"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtInput
        v-model="serial"
        label="空调序号"
        required
        hint="铭牌号或资产号，全场不重复"
      />
      <DtInput v-model="name" label="空调名称" required />
      <DtSelect
        v-model="workshopId"
        label="所属车间"
        required
        :options="workshopOptions"
      />
      <DtSelect
        v-model="roomId"
        label="所在房间"
        required
        :disabled="workshopId === ''"
        :options="roomOptions"
        hint="同一房间内的空调共处一个热力空间，会互相影响"
      />
      <DtNotice v-if="workshopId !== '' && rooms.length === 0" intent="warning">
        这个车间下还没有房间，请先到「空间配置」建一个。
      </DtNotice>
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    </form>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton :loading="busy" :disabled="!canSubmit" @click="onSubmit">
        保存
      </DtButton>
    </template>
  </DtModal>
</template>
