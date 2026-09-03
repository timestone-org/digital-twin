<script setup lang="ts">
/**
 * @fileoverview 一个模型版本的详情：输入契约、指标、指纹，以及一键注册为公式。
 *
 * ⚠ 输入契约摆的是**特征工程之前**的列（模型签名的 `inputs`），不是
 * `feature_keys`：带独热或时间特征的链上两者个数就不同，把后者摆出来会让用户
 * 去填一批根本不该由他提供的派生列（docs/MODELING_PLATFORM_DESIGN.md D4）。
 */
import type { ModelingVersion } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtTag } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import PermGuard from '@/components/PermGuard.vue'

import SignatureTable from './SignatureTable.vue'

const props = defineProps<{
  version: ModelingVersion | null
  isBusy: boolean
}>()

const emit = defineEmits<{
  register: [fxCode: string]
  close: []
}>()

const fxCode = ref('')

const inputs = computed(() => props.version?.signature.inputs ?? [])
const derived = computed(() => props.version?.signature.derived ?? [])
const metrics = computed(() =>
  Object.entries(props.version?.metrics ?? {}).filter(
    ([, value]) => value !== null,
  ),
)
const fingerprint = computed(() =>
  Object.entries(props.version?.fingerprint ?? {}),
)

/** 注册出来的公式体长什么样。⚠ 形参顺序 = 入口契约的顺序，位置天然对齐。 */
const preview = computed(() => {
  const slots = inputs.value
    .map((item) => `{${item.label || item.key}}`)
    .join(', ')
  return `PREDICT('${fxCode.value || '公式标识'}'${slots ? `, ${slots}` : ''})`
})

watch(
  () => props.version,
  (version) => {
    fxCode.value = version?.name ?? ''
  },
)
</script>

<template>
  <DtModal
    :model-value="props.version !== null"
    :title="
      props.version ? `${props.version.name} v${props.version.version}` : ''
    "
    :description="props.version?.algo ?? ''"
    width="52rem"
    @update:model-value="emit('close')"
  >
    <div v-if="props.version" class="dt-ml-detail flex flex-col gap-4">
      <DtNotice v-if="!props.version.is_servable" intent="danger">
        这个版本不可上线：{{ props.version.unservable_reason }}
      </DtNotice>

      <section>
        <h4 class="dt-ml-detail__title">要提供哪几列</h4>
        <SignatureTable :rows="inputs" />
        <p v-if="derived.length > 0" class="dt-ml-detail__derived">
          另有 {{ derived.length }} 列由流水线自己造：
          <code v-for="item in derived" :key="item.key">{{ item.label }}</code>
          ——这些**不用**调用方提供。
        </p>
      </section>

      <section v-if="metrics.length > 0">
        <h4 class="dt-ml-detail__title">发布时冻结的指标</h4>
        <p class="dt-ml-detail__row">
          <DtTag
            v-for="[name, value] in metrics"
            :key="name"
            intent="neutral"
            size="sm"
          >
            {{ name }} {{ value }}
          </DtTag>
        </p>
      </section>

      <section v-if="fingerprint.length > 0">
        <h4 class="dt-ml-detail__title">拿什么训的、在什么环境里训的</h4>
        <p class="dt-ml-detail__row dt-ml-detail__row--mono">
          <span v-for="[name, value] in fingerprint" :key="name">
            {{ name }}={{ value }}
          </span>
        </p>
      </section>

      <PermGuard
        :codes="[
          PERMISSION_CODES.modelingPublish,
          PERMISSION_CODES.datasetManage,
        ]"
        explain
      >
        <section>
          <h4 class="dt-ml-detail__title">注册为公式</h4>
          <p class="dt-ml-detail__hint">
            一步建好公式库条目与绑定。形参名取上面那几列的显示名，顺序也照它——
            于是台账里写 <code>@标识(列, 列)</code> 时位置天然对齐。
          </p>
          <div class="dt-ml-detail__register">
            <DtInput
              v-model="fxCode"
              label="公式标识"
              hint="台账列里用 @标识(…) 引用它；已存在时不覆盖"
            />
            <DtButton
              :disabled="fxCode.trim() === '' || !props.version.is_servable"
              :loading="props.isBusy"
              @click="emit('register', fxCode.trim())"
            >
              注册
            </DtButton>
          </div>
          <p class="dt-ml-detail__preview">{{ preview }}</p>
        </section>
      </PermGuard>
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('close')">关闭</DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-ml-detail {
  &__title {
    margin: 0 0 0.375rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-fs-sm);

    &--mono {
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: var(--ctl-hint-fs-md);
    }
  }

  &__derived,
  &__hint {
    margin: 0.375rem 0 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }

  &__register {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
    margin-top: 0.5rem;

    > :first-child {
      flex: 1;
    }
  }

  &__preview {
    margin: 0.5rem 0 0;
    padding: 0.375rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-title);
    font-family: var(--font-mono);
    font-size: var(--ctl-hint-fs-md);
    overflow-x: auto;
  }

  code {
    font-family: var(--font-mono);
  }
}
</style>
