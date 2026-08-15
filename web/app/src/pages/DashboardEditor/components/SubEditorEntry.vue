<script setup lang="ts">
/**
 * @fileoverview 整页子编辑器的入口按钮：某个 config 键复杂到两列表单表达不了时，
 * 属性面板在那个字段的位置画这一块，而不是画通用控件。
 *
 * ⚠ 这里对被接管的那段 config 一无所知，也不许知道：认的是 manifest 上的
 * `subEditor` 声明（`ModuleSubEditor`）。一旦在这里按模块类型分支，
 * 第三方模块就永远开不出自己的子编辑器——而且既不报错也不失败。
 */
import type { ModuleSubEditor } from '@dt/contracts'
import { DtButton } from '@dt/ui'
import { computed } from 'vue'

import { useOpenSubEditor } from '@/features/dashboard/editorContext'

const props = defineProps<{
  subEditor: ModuleSubEditor
  /** 被接管的那段 config 的当前值，只用来判断配没配过。 */
  value: unknown
}>()

const open = useOpenSubEditor()

/** 配过没有：非空对象即算配过。不解读内容，那是子编辑器的事。 */
const configured = computed(
  () =>
    typeof props.value === 'object' &&
    props.value !== null &&
    Object.keys(props.value).length > 0,
)
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <DtButton
        v-if="open !== null"
        variant="outline"
        size="sm"
        @click="open(subEditor)"
      >
        {{ subEditor.label }}
      </DtButton>
      <span class="text-xs" :class="configured ? 'text-text-secondary' : 'text-text-disabled'">
        {{ configured ? '已配置' : '尚未配置' }}
      </span>
    </div>
    <p v-if="subEditor.hint !== undefined" class="text-xs text-text-disabled">
      {{ subEditor.hint }}
    </p>
  </div>
</template>
