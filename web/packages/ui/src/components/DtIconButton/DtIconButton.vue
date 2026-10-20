<script setup lang="ts">
/** @fileoverview 带中文名称和悬浮提示的图标按钮，规范见 web/docs/ICON_BUTTON_GUIDELINES.md。 */
import type { DtButtonVariant, DtIntent, DtSize } from '@dt/contracts'
import { DT_CONTROL_ICON_PX } from '@dt/contracts'
import type { IconName } from '../DtIcon/registry'
import DtButton from '../DtButton/DtButton.vue'
import DtIcon from '../DtIcon/DtIcon.vue'
import DtTooltip from '../DtTooltip/DtTooltip.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    icon: IconName
    label: string
    tooltip?: string
    size?: DtSize
    variant?: DtButtonVariant
    intent?: DtIntent
    disabled?: boolean | undefined
    loading?: boolean
    pressed?: boolean | undefined
  }>(),
  {
    size: 'sm',
    variant: 'ghost',
    intent: 'neutral',
    disabled: false,
    loading: false,
    pressed: undefined,
  },
)

defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <DtTooltip v-slot="{ describedby }" :content="props.tooltip || props.label">
    <DtButton
      v-bind="$attrs"
      :icon="props.icon"
      :size="props.size"
      :variant="props.variant"
      :intent="props.intent"
      :disabled="props.disabled"
      :loading="props.loading"
      :pressed="props.pressed"
      :aria-label="props.label"
      :aria-describedby="describedby"
      @click="$emit('click', $event)"
    >
      <template #leading>
        <DtIcon :name="props.icon" :size="DT_CONTROL_ICON_PX[props.size]" />
        <span class="dt-icon-button__label">{{ props.label }}</span>
      </template>
    </DtButton>
  </DtTooltip>
</template>

<style scoped lang="scss">
.dt-icon-button__label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
