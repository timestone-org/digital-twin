<script setup lang="ts">
/**
 * @fileoverview 把一个模型版本绑到一条台账公式上。
 *
 * ⚠ 形参按**位置**对应特征列，不按名字：公式里 `PREDICT('code', a, b)` 的 a、b
 * 依次喂给版本的第 1、2 个特征列。界面上把这层对应关系明写出来，否则用户只能
 * 从算错的结果里反推（MODELING_DESIGN §6.4）。
 */
import type { ModelingVersionSummary } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice } from '@dt/ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  version: ModelingVersionSummary | null
  isBusy: boolean
}>()

const emit = defineEmits<{
  submit: [fxCode: string]
  close: []
}>()

const fxCode = ref('')

const signature = computed(() => {
  const keys = props.version?.feature_keys ?? []
  const args = keys.map((_, at) => `参数${at + 1}`).join(', ')
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
        hint="台账列里用 PREDICT('编码', …) 引用它；编码在公式库里唯一"
        required
      />
      <section v-if="props.version" class="dt-ml-bind__params">
        <h4>形参按位置对应特征列</h4>
        <ol>
          <li v-for="(key, at) in props.version.feature_keys" :key="key">
            第 {{ at + 1 }} 个参数 → <code>{{ key }}</code>
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
