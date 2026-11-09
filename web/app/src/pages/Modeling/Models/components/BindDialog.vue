<script setup lang="ts">
/**
 * @fileoverview 把一个模型版本绑到一条台账公式上。
 *
 * ⚠ 形参按**位置**对应入口契约（签名的 `inputs`，特征工程之前的列），不按名字，
 * 也不是 `feature_keys`：带独热或时间特征的链上两者个数就不同
 * （docs/MODELING_PLATFORM_DESIGN.md D4）。只有早于签名 2.0 的版本才退回特征列。
 */
import type { ModelingVersion } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice } from '@dt/ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  version: ModelingVersion | null
  isBusy: boolean
}>()

const emit = defineEmits<{
  submit: [fxCode: string]
  close: []
}>()

const fxCode = ref('')

/** 按位置排好的形参：入口契约优先，旧版本没有契约时退回特征列。 */
const slots = computed(() => {
  const inputs = props.version?.signature.inputs ?? []
  if (inputs.length > 0)
    return inputs.map((item) => ({ key: item.key, label: item.label }))
  return (props.version?.feature_keys ?? []).map((key) => ({ key, label: '' }))
})

const signature = computed(() => {
  const args = slots.value.map((_, at) => `参数${at + 1}`).join(', ')
  return `PREDICT('${fxCode.value || '公式编码'}'${args ? `, ${args}` : ''})`
})

watch(
  () => props.version,
  () => {
    fxCode.value = ''
  },
)
</script>

<template>
  <DtModal
    :model-value="props.version !== null"
    title="绑到台账公式"
    :description="
      props.version ? `${props.version.name} v${props.version.version}` : ''
    "
    width="30rem"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <DtNotice
        v-if="props.version && !props.version.is_servable"
        intent="danger"
      >
        这个版本不可用于取数：{{ props.version.unservable_reason }}
      </DtNotice>
      <DtInput
        v-model="fxCode"
        label="公式编码"
        hint="填公式库里已有的自定义公式编码；还没有的话先在版本详情里「注册为公式」"
        required
      />
      <section v-if="props.version" class="dt-ml-bind__params">
        <h4>形参按位置对应入口列</h4>
        <ol>
          <li v-for="(slot, at) in slots" :key="slot.key">
            第 {{ at + 1 }} 个参数 →
            <template v-if="slot.label && slot.label !== slot.key">
              {{ slot.label }}（<code>{{ slot.key }}</code
              >）
            </template>
            <code v-else>{{ slot.key }}</code>
          </li>
        </ol>
        <p class="dt-ml-bind__signature">{{ signature }}</p>
      </section>
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('close')">取消</DtButton>
      <DtButton
        :disabled="fxCode.trim() === ''"
        :loading="props.isBusy"
        @click="emit('submit', fxCode.trim())"
      >
        绑定
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-ml-bind {
  &__params {
    h4 {
      margin: 0 0 0.25rem;
      color: var(--text-secondary);
      font-size: var(--ctl-hint-fs-sm);
    }

    ol {
      margin: 0;
      padding-left: 1.25rem;
      color: var(--text-primary);
      font-size: var(--ctl-fs-sm);
    }

    code {
      font-family: var(--font-mono);
    }
  }

  &__signature {
    margin: 0.5rem 0 0;
    padding: 0.375rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-title);
    font-family: var(--font-mono);
    font-size: var(--ctl-hint-fs-md);
  }
}
</style>
