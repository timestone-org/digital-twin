<script setup lang="ts">
/**
 * @fileoverview 「试一条路径」：自带触发按钮，在弹窗里预演闸 1 的判定。
 *
 * ⚠ 结果是**预演**：真正的判定在 auth-server。它存在的理由是排序错了就是
 * 直接 403，而排序错误只看表是看不出来的——必须能试。
 */
import { computed, ref } from 'vue'
import type { DtSelectOption, RouteRule } from '@dt/contracts'
import { HTTP_METHODS } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtSelect, DtTag } from '@dt/ui'

import { useAuthStore } from '@/stores/auth'
import { decide } from '../matcher'

const props = defineProps<{ rules: readonly RouteRule[] }>()

const auth = useAuthStore()

const open = ref(false)

/**
 * 关窗不重置：用法是「试一条 → 回表里改规则 → 再试同一条」，
 * 重置会让人每次都把同一条路径重打一遍，而它正是要反复对照的那个输入。
 */
const method = ref('GET')
const path = ref('/api/v1/auth/users')

const METHOD_OPTIONS: readonly DtSelectOption[] = HTTP_METHODS.map((name) => ({
  value: name,
  label: name,
}))

const OUTCOME_TEXT = {
  granted: { label: '放行', intent: 'success' },
  insufficient: { label: '权限不足 → 403', intent: 'danger' },
  no_rule: { label: '无规则命中 → 拒绝', intent: 'warning' },
} as const

const result = computed(() =>
  decide(props.rules, path.value, method.value, auth.permissions),
)
const outcome = computed(() => OUTCOME_TEXT[result.value.outcome])
</script>

<template>
  <div class="flex">
    <DtButton
      variant="outline"
      intent="neutral"
      size="sm"
      icon="route"
      @click="open = true"
    >
      试一条路径
    </DtButton>
  </div>

  <DtModal
    v-model="open"
    title="试一条路径"
    width="32rem"
    description="排序错了就是直接 403，而排序错误只看这张表是看不出来的"
  >
    <div class="flex flex-col gap-4">
      <!-- ⚠ 顶对齐而非 items-end：只有「路径」带 hint，按底边对齐会把它整列顶高一行 -->
      <div class="flex flex-wrap items-start gap-3">
        <!-- ⚠ 关掉搜索框：它随浮层 teleport 到弹窗面板之外，焦点一进去就跳出了 DtModal 的焦点陷阱 -->
        <DtSelect
          v-model="method"
          class="w-32"
          label="方法"
          :options="METHOD_OPTIONS"
          :searchable="false"
        />
        <DtInput
          v-model="path"
          class="min-w-[16rem] flex-1"
          label="路径"
          hint="query 与末尾斜杠会被忽略，与服务端同口径"
        />
      </div>

      <div class="flex flex-wrap items-center gap-2 text-xs">
        <DtTag :intent="outcome.intent" size="md">{{ outcome.label }}</DtTag>
        <template v-if="result.rule">
          <span class="text-text-secondary">命中</span>
          <code class="text-accent-secondary">
            {{ result.rule.http_method }} {{ result.rule.path_pattern }}
          </code>
          <span class="text-text-disabled">
            priority {{ result.rule.priority }}
          </span>
        </template>
        <span v-else class="text-text-disabled">
          受管前缀上没有任何规则命中，按 fail-closed 拒绝
        </span>
      </div>

      <DtNotice intent="warning" icon="alert-triangle">
        按你当前持有的 {{ auth.permissions.size }} 个权限码预演；
        真正的判定在服务端。
      </DtNotice>
    </div>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="open = false">
        关闭
      </DtButton>
    </template>
  </DtModal>
</template>
