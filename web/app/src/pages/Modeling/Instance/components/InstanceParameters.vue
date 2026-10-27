<script setup lang="ts">
/** @fileoverview 模型参数的表单、完整 JSON 和 Schema 工作面。 */
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtInput, DtNotice, DtTextarea } from '@dt/ui'
import { computed, ref } from 'vue'
import PermGuard from '@/components/PermGuard.vue'
import type { useInstanceEditor } from '../scripts/useInstanceEditor'
import ParameterWorkspace from './ParameterWorkspace.vue'
const props = defineProps<{
  editor: ReturnType<typeof useInstanceEditor>
  canRun: boolean
}>()
const emit = defineEmits<{
  name: [value: string]
  description: [value: string]
  draft: [value: string]
  change: [node: string, key: string, value: unknown]
  error: [key: string, message: string]
  reload: []
  save: []
}>()
const mode = ref('form')
const disabled = computed(
  () => !props.canRun || props.editor.busy.value || props.editor.training.value,
)
const hasChanges = computed(
  () => props.editor.dirty.value || props.editor.fieldError.value !== '',
)
</script>
<template>
  <section class="instance-section">
    <div class="instance-heading">
      <div>
        <h2>模型参数</h2>

        <p>修改数据来源、输入列、目标与算法参数，保存后开始训练。</p>
      </div>

      <div class="flex gap-2">
        <DtButton
          size="sm"
          variant="ghost"
          :pressed="mode === 'form'"
          @click="mode = 'form'"
        >
          参数表单
        </DtButton>

        <DtButton
          size="sm"
          variant="ghost"
          :pressed="mode === 'json'"
          @click="mode = 'json'"
        >
          完整 JSON
        </DtButton>

        <DtButton
          size="sm"
          variant="ghost"
          :pressed="mode === 'schema'"
          @click="mode = 'schema'"
        >
          配置 Schema
        </DtButton>
      </div>
    </div>

    <div class="dt-form-grid">
      <DtInput
        :model-value="editor.name.value"
        label="模型名称"
        :maxlength="128"
        :disabled="disabled"
        @update:model-value="emit('name', $event)"
      />

      <DtInput
        :model-value="editor.description.value"
        label="模型说明"
        :maxlength="512"
        :disabled="disabled"
        @update:model-value="emit('description', $event)"
      />
    </div>

    <DtNotice v-if="hasChanges" intent="warning">
      有尚未保存的参数。保存全部配置后才能开始训练。
    </DtNotice>

    <DtNotice
      v-if="editor.parsed.value.error || editor.fieldError.value"
      intent="danger"
    >
      {{ editor.parsed.value.error || editor.fieldError.value }}
    </DtNotice>

    <ParameterWorkspace
      v-show="mode === 'form'"
      :key="editor.resetKey.value"
      :nodes="editor.detail.value?.nodes ?? []"
      :configuration="editor.parsed.value.value"
      :disabled="disabled"
      @change="(node, key, value) => emit('change', node, key, value)"
      @error="(key, message) => emit('error', key, message)"
    />

    <DtTextarea
      v-if="mode === 'json'"
      :model-value="editor.draft.value"
      label="全部节点配置"
      hint="nodes 的键是节点 ID；保留所有节点，仅修改每个节点的参数对象。"
      :rows="18"
      :disabled="disabled"
      @update:model-value="emit('draft', $event)"
    />

    <DtTextarea
      v-if="mode === 'schema'"
      :model-value="JSON.stringify(editor.detail.value?.json_schema, null, 2)"
      label="完整配置 JSON Schema"
      :rows="18"
      readonly
    />

    <div class="instance-save">
      <span>
        {{
          editor.training.value
            ? '训练进行中，参数暂时锁定'
            : '所有节点参数统一校验并保存'
        }}
      </span>

      <div class="flex gap-2">
        <DtButton
          size="sm"
          variant="ghost"
          :disabled="editor.busy.value"
          @click="emit('reload')"
        >
          重新加载
        </DtButton>

        <PermGuard :codes="[PERMISSION_CODES.modelingRun]">
          <DtButton
            :disabled="
              disabled ||
              !hasChanges ||
              !editor.parsed.value.value ||
              !!editor.fieldError.value ||
              !editor.name.value.trim()
            "
            @click="emit('save')"
          >
            {{ editor.busy.value ? '正在保存…' : '保存全部配置' }}
          </DtButton>
        </PermGuard>
      </div>
    </div>
  </section>
</template>
<style scoped lang="scss">
.instance-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
}
.instance-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}
h2 {
  font-size: var(--font-size-section);
  font-weight: 600;
}
p {
  color: var(--text-secondary);
  font-size: var(--font-size-compact);
}
.instance-save {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
  align-items: center;
  padding-top: 1rem;
  border-top: 1px solid var(--border-default);
  color: var(--text-secondary);
  font-size: var(--font-size-compact);
}
</style>
