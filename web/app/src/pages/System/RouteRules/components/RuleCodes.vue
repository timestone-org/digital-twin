<script setup lang="ts">
/**
 * @fileoverview 一条规则要求的权限码，表格与卡片共用。
 * ⚠ 只有一个码时 any 与 all 结果完全相同，标出模式反而暗示有区别，故不渲染。
 */
import { computed } from 'vue'
import type { MatchMode } from '@dt/contracts'
import { DtTag } from '@dt/ui'

import CodeChips from '@/pages/System/components/CodeChips.vue'

const props = defineProps<{ codes: readonly string[]; mode: MatchMode }>()

const anyMode = computed(() => props.mode === 'any' && props.codes.length > 1)
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <!-- 排在 chips 之前：它是这串码的读法（「满足其一：a、b」），排在后面要回读 -->
    <DtTag v-if="anyMode" intent="info" title="持有其中任意一个即可通过">
      满足其一
    </DtTag>
    <CodeChips :codes="codes" empty="任意登录用户" />
  </div>
</template>
