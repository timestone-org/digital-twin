<script setup lang="ts">
/**
 * @fileoverview DtField —— 表单字段外壳：标签、提示、错误与 a11y 关联。
 * 默认插槽拿到 id / describedby / invalid，由具体控件绑到自己的元素上。
 */
import { computed, useId } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSize } from '@dt/contracts'

const props = withDefaults(
  // ⚠ 显式写出 `| undefined`：开着 exactOptionalPropertyTypes 时
  // 「没有这个属性」与「属性值是 undefined」是两回事，透传方传下来的是后者。
  defineProps<{
    label?: string | undefined
    hint?: string | undefined
    error?: string | undefined
    required?: boolean | undefined
    size?: DtSize | undefined
  }>(),
  { required: false, size: DT_CONTROL_DEFAULT_SIZE },
)

const controlId = useId()
const hintId = `${controlId}-hint`
const errorId = `${controlId}-error`

const invalid = computed(() => Boolean(props.error))
/** error 与 hint 同传时只渲染 error，否则 describedby 会指向未渲染的节点。 */
const shownHint = computed(() => (props.error ? undefined : props.hint))
const describedby = computed(() => {
  if (props.error) return errorId
  return props.hint ? hintId : undefined
})
</script>

<template>
  <div class="dt-field" :class="`dt-field--${size}`">
    <label v-if="label" class="dt-field__label" :for="controlId">
      {{ label }}
      <span v-if="required" class="dt-field__required" aria-hidden="true">
        *
      </span>
    </label>
    <slot :id="controlId" :describedby="describedby" :invalid="invalid" />
    <p v-if="shownHint" :id="hintId" class="dt-field__hint">{{ shownHint }}</p>
    <p v-if="error" :id="errorId" class="dt-field__error" role="alert">
      {{ error }}
    </p>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__label {
    color: var(--text-secondary);
    line-height: 1.2;
  }

  &__required {
    color: var(--state-danger);
  }

  &__hint,
  &__error {
    margin: 0;
    line-height: 1.3;
    font-size: var(--ctl-hint-fs-md);
  }

  &__hint {
    color: var(--text-disabled);
  }

  &__error {
    color: var(--state-danger);
  }
}

@each $size in ctl.$sizes {
  .dt-field--#{$size} .dt-field__label {
    font-size: var(--ctl-label-fs-#{$size});
  }
}
</style>
