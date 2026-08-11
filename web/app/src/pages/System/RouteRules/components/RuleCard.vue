<script setup lang="ts">
/**
 * @fileoverview 路由规则的卡片形态。
 * ⚠ 顺序即语义（首条命中即终局），而卡片按宽度铺成多列后，「排在哪」这件事
 * 网格本身已经表达不了了——判定序**只由**左上角的 `#n` 承载，它不是装饰。
 * 卡上因此有两个不同的数字：`#n` 是「第几个被检查」，priority 是「凭什么排在这」。
 */
import { computed } from 'vue'
import type { RouteRule } from '@dt/contracts'
import { DtCard } from '@dt/ui'

import { INACTIVE_CARD_VARS } from '../../components/cardVars'
import MethodTag from './MethodTag.vue'
import RuleBadges from './RuleBadges.vue'
import RuleCodes from './RuleCodes.vue'
import RulePattern from './RulePattern.vue'
import RuleRowActions from './RuleRowActions.vue'

const props = defineProps<{ rule: RouteRule; order: number }>()

const emit = defineEmits<{
  edit: [rule: RouteRule]
  'toggle-enabled': [rule: RouteRule]
  remove: [rule: RouteRule]
}>()

// 停用的规则整卡下沉，与用户页的停用账号共用同一套变量
const cardVars = computed<Readonly<Record<string, string>>>(() =>
  props.rule.is_enabled ? {} : INACTIVE_CARD_VARS,
)
</script>

<template>
  <DtCard
    padding="sm"
    class="rule-card flex flex-col"
    :class="{ 'rule-card--off': !rule.is_enabled }"
    :style="cardVars"
  >
    <template #header>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-w-0 items-center gap-3">
          <span class="flex shrink-0 items-center gap-2">
            <span
              class="rule-card__step font-mono text-2xs text-accent-secondary"
              :title="`第 ${order} 个被检查`"
              >#{{ order }}</span
            >
            <span v-if="!rule.is_enabled" class="text-3xs text-text-disabled">
              不参与判定
            </span>
          </span>
          <h2 class="m-0 flex min-w-0 items-center gap-2 text-sm font-semibold">
            <MethodTag :method="rule.http_method" class="shrink-0" />
            <RulePattern :rule="rule" />
          </h2>
          <RuleBadges :rule="rule" emphasis class="ml-auto" />
        </div>
        <!-- 副标识缺席也占一行：与用户卡、角色卡同一句式，链节间距才均匀 -->
        <p class="m-0 mt-1 truncate text-2xs text-text-disabled">
          {{ rule.description || '未填写描述' }}
        </p>
      </div>
    </template>

    <!-- 两条事实同一种排法：标签靠左、取值靠右。码多会换行，靠右对齐让它们
         始终贴着取值列，不会在标签下方铺开把两行读成一行 -->
    <div class="flex flex-1 flex-col gap-2">
      <div class="flex items-baseline justify-between gap-3">
        <span class="shrink-0 text-3xs text-text-disabled">需要权限</span>
        <RuleCodes
          class="min-w-0 flex-1 justify-end"
          :codes="rule.permission_codes"
          :mode="rule.match_mode"
        />
      </div>
      <div class="flex items-baseline justify-between gap-3">
        <span class="shrink-0 text-3xs text-text-disabled">
          优先级（越大越先判）
        </span>
        <span class="font-mono text-xs text-text-primary">
          {{ rule.priority }}
        </span>
      </div>
      <RuleRowActions
        class="mt-auto border-t border-border-subtle pt-2"
        :rule="rule"
        @edit="emit('edit', rule)"
        @toggle-enabled="emit('toggle-enabled', rule)"
        @remove="emit('remove', rule)"
      />
    </div>
  </DtCard>
</template>

<style scoped lang="scss">
.rule-card {
  &__step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-pill);
    background: var(--surface-sunken);
  }

  // 虚线节点 = 这一站被跳过；形状通道，不依赖颜色
  &--off &__step {
    border-style: dashed;
    color: var(--text-disabled);
  }
}
</style>
