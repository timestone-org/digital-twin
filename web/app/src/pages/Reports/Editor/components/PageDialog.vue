<script setup lang="ts">
/** @fileoverview Word 纸张、页边距与页眉页脚配置。 */
import { useFormDirty } from '@/composables/useFormDirty'
import { ref, watch } from 'vue'
import { DtButton, DtInput, DtModal, DtSelect, DtCheckbox } from '@dt/ui'
import type { ReportPage } from '@dt/contracts'
const props = defineProps<{ modelValue: boolean; page: ReportPage }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [page: ReportPage]
}>()
const size = ref('A4')
const orientation = ref('portrait')
const header = ref('')
const footer = ref('')
const watermark = ref('')
const fontSize = ref('12')
const toc = ref(false)
const margins = ref({
  top: '2.54',
  bottom: '2.54',
  left: '3.18',
  right: '3.18',
})
const dirty = useFormDirty(
  [size, orientation, header, footer, watermark, fontSize, toc, margins],
  () => props.modelValue,
)
const sides = [
  { key: 'top', label: '上' },
  { key: 'bottom', label: '下' },
  { key: 'left', label: '左' },
  { key: 'right', label: '右' },
] as const
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    size.value = props.page.size ?? 'A4'
    orientation.value = props.page.orientation ?? 'portrait'
    header.value = props.page.header ?? ''
    footer.value = props.page.footer ?? ''
    watermark.value = props.page.watermark?.text ?? ''
    fontSize.value = String(props.page.font_size_pt ?? 12)
    toc.value = props.page.is_toc_enabled ?? false
    resetMargins()
  },
)
function resetMargins(): void {
  for (const side of sides)
    margins.value[side.key] = String(
      props.page.margins_cm?.[side.key] ??
        (side.key === 'left' || side.key === 'right' ? 3.18 : 2.54),
    )
}
function save(): void {
  const paper =
    size.value === 'A3' ||
    size.value === 'Letter' ||
    size.value === 'Legal' ||
    size.value === 'custom'
      ? size.value
      : 'A4'
  emit('save', {
    ...props.page,
    size: paper,
    orientation: orientation.value === 'landscape' ? 'landscape' : 'portrait',
    header: header.value,
    footer: footer.value,
    font_size_pt: Number(fontSize.value),
    is_toc_enabled: toc.value,
    watermark: { ...props.page.watermark, text: watermark.value },
    margins_cm: {
      top: Number(margins.value.top),
      bottom: Number(margins.value.bottom),
      left: Number(margins.value.left),
      right: Number(margins.value.right),
    },
  })
  emit('update:modelValue', false)
}
</script>
<template>
  <DtModal
    :dirty="dirty.isDirty.value"
    :model-value="modelValue"
    title="页面设置"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtSelect
        v-model="size"
        label="纸张"
        size="sm"
        :options="[
          { value: 'A4', label: 'A4' },
          { value: 'A3', label: 'A3' },
          { value: 'Letter', label: 'Letter' },
          { value: 'Legal', label: 'Legal' },
        ]"
      />
      <DtSelect
        v-model="orientation"
        label="方向"
        size="sm"
        :options="[
          { value: 'portrait', label: '纵向' },
          { value: 'landscape', label: '横向' },
        ]"
      />
      <div class="grid grid-cols-2 gap-3">
        <DtInput
          v-for="side in sides"
          :key="side.key"
          v-model="margins[side.key]"
          :label="`${side.label}边距（厘米）`"
          size="sm"
        />
      </div>
      <DtInput v-model="fontSize" label="正文字号（磅）" size="sm" />
      <DtInput v-model="header" label="页眉" size="sm" />
      <DtInput v-model="footer" label="页脚" size="sm" />
      <DtInput v-model="watermark" label="水印文字" size="sm" />
      <DtCheckbox v-model="toc" label="生成目录" />
    </div>
    <template #footer>
      <DtButton size="sm" icon="check" @click="save">应用</DtButton>
    </template>
  </DtModal>
</template>
