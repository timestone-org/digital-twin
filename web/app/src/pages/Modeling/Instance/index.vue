<script setup lang="ts">
/** @fileoverview 模型实例的配置、训练、版本与部署工作面。 */
import type { ModelingRunSummary, ModelingVersionSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtNotice,
  DtPageState,
  DtTag,
  useConfirm,
  useToast,
} from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { trainInstance } from '@/api/modelingTemplates'
import { cancelModelingRun, publishModelingVersion } from '@/api/modeling'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useAuthStore } from '@/stores/auth'
import ModelingNav from '../components/ModelingNav.vue'
import { runLabel } from '../scripts/instancePresentation'
import DeployModelDialog from './components/DeployModelDialog.vue'
import InstanceHistory from './components/InstanceHistory.vue'
import InstanceParameters from './components/InstanceParameters.vue'
import { useInstanceEditor } from './scripts/useInstanceEditor'

const route = useRoute()
const id = computed(() => String(route.params['instanceId'] ?? ''))
const editor = useInstanceEditor(id)
const auth = useAuthStore()
const toast = useToast()
const confirm = useConfirm()
let isDisposed = false
onBeforeUnmount(() => {
  isDisposed = true
})
const deploying = ref<ModelingVersionSummary | null>(null)
const canRun = computed(() => auth.can([PERMISSION_CODES.modelingRun]))
const hasChanges = computed(
  () => editor.dirty.value || editor.fieldError.value !== '',
)
const disabled = computed(
  () => !canRun.value || editor.busy.value || editor.training.value,
)
watch(id, () => void editor.load(), { immediate: true })

async function runAction(
  task: () => Promise<unknown>,
  message: string,
): Promise<void> {
  if (editor.busy.value) return
  const modelId = id.value
  const isCurrent = () => !isDisposed && id.value === modelId
  editor.busy.value = true
  editor.error.value = ''
  try {
    await task()
    if (!isCurrent()) return
    toast.success(message)
    await editor.refresh()
  } catch (caught) {
    if (isCurrent()) editor.error.value = describeError(caught)
  } finally {
    if (isCurrent()) editor.busy.value = false
  }
}
function train(): void {
  if (!hasChanges.value && !editor.training.value)
    void runAction(
      () => trainInstance(id.value),
      '已提交训练，离开页面后仍会继续执行',
    )
}
function cancel(): void {
  const run = editor.instance.value?.latest_run
  if (run) void runAction(() => cancelModelingRun(run.id), '已请求取消训练')
}
function publish(run: ModelingRunSummary): void {
  void runAction(
    () =>
      publishModelingVersion({
        run_id: run.id,
        name: editor.instance.value?.name ?? '模型',
        description: editor.instance.value?.description,
      }),
    '模型版本已发布，可继续部署',
  )
}

async function discard(): Promise<void> {
  if (
    !hasChanges.value ||
    (await confirm.ask({
      title: '重新加载模型配置？',
      message: '尚未保存的修改将被丢弃。',
      confirmText: '重新加载',
      danger: true,
    }))
  )
    await editor.load()
}
onBeforeRouteLeave(
  async () =>
    !hasChanges.value ||
    (await confirm.ask({
      title: '离开未保存的模型？',
      message: '参数修改尚未保存，离开后需要重新填写。',
      confirmText: '放弃修改并离开',
      danger: true,
    })),
)
</script>

<template>
  <AppShell
    :title="editor.instance.value?.name ?? '模型实例'"
    subtitle="集中配置 · 训练 · 发布 · 部署"
    back-to="/modeling/instances"
  >
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.modelingRun]">
        <DtButton
          v-if="editor.training.value"
          variant="ghost"
          :disabled="editor.busy.value"
          @click="cancel"
        >
          取消训练
        </DtButton>

        <DtButton
          :disabled="
            disabled ||
            hasChanges ||
            editor.loading.value ||
            !editor.instance.value
          "
          @click="train"
        >
          开始训练
        </DtButton>
      </PermGuard>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-4">
      <ModelingNav />

      <DtNotice v-if="editor.error.value" intent="danger">
        {{ editor.error.value }}
        <DtButton size="xs" variant="ghost" @click="void discard()">
          重新加载
        </DtButton>
      </DtNotice>

      <DtPageState
        v-if="editor.loading.value || !editor.instance.value"
        :loading="editor.loading.value"
        :empty="false"
        :error="editor.error.value || null"
        @retry="void editor.load()"
      />

      <div v-else class="instance-body">
        <div class="instance-summary">
          <div>
            <span class="instance-eyebrow"> 来源模板 </span>

            <strong>
              {{ editor.instance.value.template_name }} · v{{
                editor.instance.value.template_version
              }}
            </strong>
          </div>

          <div>
            <span class="instance-eyebrow"> 模型编码 </span>

            <strong>
              {{ editor.instance.value.code }}
            </strong>
          </div>

          <div>
            <span class="instance-eyebrow"> 配置版本 </span>

            <strong> r{{ editor.instance.value.revision }} </strong>
          </div>

          <DtTag
            :intent="
              editor.instance.value.latest_run?.status === 'succeeded'
                ? 'success'
                : 'neutral'
            "
          >
            {{ runLabel(editor.instance.value.latest_run?.status) }}
          </DtTag>
        </div>

        <InstanceParameters
          :editor="editor"
          :can-run="canRun"
          @name="editor.name.value = $event"
          @description="editor.description.value = $event"
          @draft="editor.draft.value = $event"
          @change="editor.change"
          @error="(key, message) => (editor.fieldErrors.value[key] = message)"
          @reload="void discard()"
          @save="void editor.save()"
        />
        <InstanceHistory
          :id="id"
          :runs="editor.runs.value"
          :versions="editor.versions.value"
          :totals="editor.totals.value"
          :busy="editor.busy.value"
          @refresh="void editor.refresh()"
          @publish="publish"
          @deploy="deploying = $event"
        />
      </div>
    </div>

    <DeployModelDialog
      :instance-id="id"
      :version="deploying"
      @close="deploying = null"
      @deployed="void editor.refresh()"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.instance-body {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-bottom: 2rem;
}
.instance-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 2rem;
  align-items: center;
  background: var(--surface-panel);
  padding: 1.25rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}
.instance-summary > div {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.instance-eyebrow {
  color: var(--text-secondary);
  font-size: var(--font-size-compact);
}
</style>
