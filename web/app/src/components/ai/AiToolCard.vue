<script setup lang="ts">
/**
 * @fileoverview 助手做的一步 —— 界面上「AI 做了什么」逐条渲染的就是它。
 * 折叠时是一行，展开后是这一步的入参、产出与截图。
 *
 * ⚠ 失败的一步照样要摆出来，而且要与成功的一眼分得开。藏起来的话，用户看到
 * 的是「助手做了几件事然后给了个奇怪的答复」，而看不出中间哪一步没成。
 *
 * ⚠ 截图**画在这里**而不是只当成一段产出：`dashboard.capture` 截的就是用户
 * 此刻这一屏，看不见它的话，「它到底看到了什么」全靠猜——而模型看错屏是这类
 * 功能最常见的失败。
 */
import { computed, ref } from 'vue'
import { DtIcon, DtModal, DtTag } from '@dt/ui'
import type { IconName } from '@dt/ui'

import type { RunnerStep } from '@/features/ai/turnRunner'

const props = defineProps<{ step: RunnerStep }>()

/** 步骤种类 → 图标。⚠ 未登记的图标名会静默不渲染，只能用注册表里有的。 */
const KIND_ICONS: Record<string, IconName> = {
  model: 'sparkles',
  server_tool: 'activity',
  client_tool: 'square-mouse-pointer',
}

const icon = computed<IconName>(() => KIND_ICONS[props.step.kind] ?? 'activity')

const isFailed = computed(() => props.step.state === 'failed')
const isWaiting = computed(() => props.step.state === 'awaiting_client')

const args = computed(() => Object.entries(props.step.input ?? {}))

/** 有没有东西可展开。没有的话整行禁用，免得点了什么都不发生。 */
const hasDetail = computed(
  () =>
    args.value.length > 0 ||
    props.step.output !== undefined ||
    props.step.image !== undefined ||
    props.step.isImageDropped === true,
)

const isOpen = ref(false)
const isZoomed = ref(false)

function toggle(): void {
  if (hasDetail.value) isOpen.value = !isOpen.value
}
</script>

<template>
  <li class="ai-step" :class="{ 'ai-step--failed': isFailed }">
    <!-- ⚠ 没东西可展开时禁用而不是换成 div：换标签的话，同一行在两种状态下
         的可聚焦性不一样，键盘走位会时有时无 -->
    <button
      type="button"
      class="ai-step__head"
      :disabled="!hasDetail"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <DtIcon :name="icon" :size="14" class="ai-step__icon" />
      <span class="ai-step__title">{{ step.title }}</span>
      <DtIcon
        v-if="step.image !== undefined"
        name="image"
        :size="13"
        class="ai-step__shot"
      />
      <DtTag v-if="isWaiting" intent="info" size="sm">等页面执行</DtTag>
      <DtIcon
        v-else-if="isFailed"
        name="alert-circle"
        :size="14"
        class="ai-step__mark"
      />
      <DtIcon v-else name="check" :size="14" class="ai-step__mark" />
      <DtIcon
        v-if="hasDetail"
        :name="isOpen ? 'chevron-down' : 'chevron-right'"
        :size="13"
        class="ai-step__fold"
      />
    </button>

    <div v-if="isOpen" class="ai-step__detail">
      <dl v-if="args.length > 0" class="ai-step__args">
        <template v-for="[key, value] in args" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>

      <figure v-if="step.image !== undefined" class="ai-step__shot-box">
        <button
          type="button"
          class="ai-step__shot-btn"
          aria-label="放大看这张截图"
          @click="isZoomed = true"
        >
          <img :src="step.image" alt="助手看到的这一屏" />
        </button>
        <figcaption>助手看到的就是这一屏</figcaption>
      </figure>
      <p v-else-if="step.isImageDropped === true" class="ai-step__gone">
        截图已释放，只留最近几张。
      </p>

      <p v-if="step.output !== undefined" class="ai-step__out">
        {{ step.output }}
      </p>
    </div>

    <p v-if="step.error" class="ai-step__reason">{{ step.error }}</p>

    <DtModal
      v-if="step.image !== undefined"
      v-model="isZoomed"
      title="助手看到的这一屏"
      width="min(72rem, 92vw)"
    >
      <div class="ai-step__zoom">
        <img :src="step.image" alt="助手看到的这一屏" />
      </div>
    </DtModal>
  </li>
</template>

<style scoped lang="scss">
.ai-step {
  display: flex;
  flex-direction: column;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.ai-step__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.ai-step__head:hover:not(:disabled) {
  background: var(--surface-raised);
}

.ai-step__head:disabled {
  cursor: default;
}

.ai-step--failed {
  color: var(--state-danger);
}

.ai-step__icon {
  flex: none;
  color: var(--accent-primary);
}

.ai-step--failed .ai-step__icon,
.ai-step--failed .ai-step__mark {
  color: var(--state-danger);
}

.ai-step__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-step__shot,
.ai-step__fold {
  flex: none;
  color: var(--text-disabled);
}

.ai-step__mark {
  flex: none;
  color: var(--state-success);
}

.ai-step__detail {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.125rem 0 0.375rem 1.75rem;
  padding: 0.5rem 0.625rem;
  border-left: 2px solid var(--border-default);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--surface-sunken);
}

/* 入参：左窄右宽两列。⚠ 这是键值对不是表格，故用 dl + grid；手写表格标签在
   本仓是被闸门拦下的 */
.ai-step__args {
  display: grid;
  grid-template-columns: minmax(4rem, auto) 1fr;
  gap: 0.125rem 0.625rem;
  margin: 0;
  font-size: 0.75rem;
}

.ai-step__args dt {
  color: var(--accent-on-surface);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.ai-step__args dd {
  margin: 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.ai-step__shot-box {
  margin: 0;
}

.ai-step__shot-btn {
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: transparent;
  cursor: zoom-in;
}

.ai-step__shot-btn img {
  display: block;
  width: 100%;
  height: auto;
}

.ai-step__shot-box figcaption {
  padding-top: 0.25rem;
  color: var(--text-disabled);
  font-size: 0.6875rem;
}

.ai-step__gone,
.ai-step__out {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.ai-step__gone {
  color: var(--text-disabled);
}

.ai-step__reason {
  margin: 0;
  padding: 0 0.5rem 0.25rem 2rem;
  color: var(--state-danger);
  font-size: 0.75rem;
  line-height: 1.5;
}

.ai-step__zoom img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--radius-sm);
}
</style>
