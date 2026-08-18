<script setup lang="ts">
/**
 * @fileoverview button 的渲染：一个原生 `<button>`，点击上抛联动事件。
 * 用原生按钮而不是 div：键盘 Enter/Space、焦点环、禁用语义与读屏角色全是白拿的，
 * 自己拼一套永远会漏掉其中一样。
 * ⚠ 形态全部收敛在 `look.ts`，本文件只摆模板——外观旋钮三十个，
 * 写在组件里会把它撑过单文件组件的行数闸门。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { DtIcon } from '@dt/ui'
import { computed } from 'vue'

import { readButtonSpec } from './look'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

const spec = computed(() => readButtonSpec(props.config))

/**
 * 上抛一次点击。配了联动值就带上它（`按值跳转` / `按值互斥切换` 用得上），
 * 没配就抛一个不带值的点击——那是显隐与弹窗类动作要的形状。
 * ⚠ 禁用档在这里也拦一道：`disabled` 属性挡得住真实点击，挡不住程序派发的事件。
 */
function onClick(): void {
  if (spec.value.isDisabled) return
  const value = spec.value.linkValue
  emit(
    'interaction',
    value === '' ? { event: 'click' } : { event: 'click', value },
  )
}
</script>

<template>
  <div class="dt-button-host" :style="spec.hostStyle">
    <button
      type="button"
      class="dt-button"
      :class="spec.classes"
      :style="spec.vars"
      :disabled="spec.isDisabled"
      :title="spec.hint === '' ? undefined : spec.hint"
      :aria-label="spec.ariaLabel"
      @click="onClick"
    >
      <i v-if="spec.isHud" class="dt-button__deco" aria-hidden="true" />
      <i v-if="spec.hasSweep" class="dt-button__sweep" aria-hidden="true" />
      <DtIcon
        v-if="spec.icon !== ''"
        :name="spec.icon"
        :size="spec.iconSize"
        class="dt-button__icon"
      />
      <span v-if="spec.hasLabel" class="dt-button__label">
        <span class="dt-button__text">{{ spec.text }}</span>
        <span v-if="spec.subText !== ''" class="dt-button__sub">{{
          spec.subText
        }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped lang="scss">
@use './variants';

// 外层只做排布：按钮按内容尺寸时落在模块矩形的哪一处由它决定
.dt-button-host {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.dt-button {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  max-height: 100%;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: var(--btn-py) var(--btn-px);
  border: var(--btn-border-w) solid transparent;
  border-radius: var(--btn-radius);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--btn-font-size);
  font-weight: var(--btn-weight);
  gap: var(--btn-gap);
  letter-spacing: var(--btn-tracking);
  line-height: 1.2;
  // 扫光与四角刻线都是绝对定位的子层，越界的部分一律裁在按钮轮廓内
  overflow: hidden;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    filter 0.18s ease,
    transform 0.12s ease;
  user-select: none;
}

.dt-button--fill {
  width: 100%;
  height: 100%;
}

// 一枚图标撑不起横向内边距，四边取同一个值收成方形
.dt-button--icon-only {
  padding: var(--btn-py);
}

.dt-button:focus-visible {
  outline: 2px solid var(--btn-accent);
  outline-offset: 2px;
}

// 禁用是「现在点不了」而不是「坏了」：压暗并换指针，形状与文案原样留着
.dt-button:disabled {
  cursor: not-allowed;
  filter: grayscale(0.4);
  opacity: 0.45;
}

.dt-button__label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: inherit;
  gap: 2px;
}

.dt-button__text,
.dt-button__sub {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// 副文案不另开字号旋钮：跟着主文案按比例走，改一个字号两行一起动
.dt-button__sub {
  font-size: 0.72em;
  font-weight: 400;
  opacity: 0.75;
}

.dt-button__icon {
  flex: none;
}

.dt-button--icon-right {
  flex-direction: row-reverse;
}

.dt-button--icon-top {
  flex-direction: column;
}
</style>
