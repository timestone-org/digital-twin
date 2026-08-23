<script setup lang="ts">
/**
 * @fileoverview 列表单里「公式计算」那一档的子块：一行表达式文本。
 *
 * 公式只有一条落库路径——就是这一行文本（docs/DATASET_DESIGN.md §6.2）。
 * 带工具箱、实时校验与分段编辑面的编辑器随后续期次挂进这里，届时它编辑的
 * 仍是同一行文本，故这个子块的对外面不会变。
 *
 * ⚠ 眼下没有前端校验：写错了要等保存时后端回 41212 才知道。文案必须把这一点
 * 说出来，否则「保存后才报错」会被当成保存坏了。
 */
import { DtNotice, DtTextarea } from '@dt/ui'

import { FORMULA_MAX } from '../scripts/columnForm'

const props = defineProps<{ formulaError: string }>()

const formula = defineModel<string>('formula', { required: true })
</script>

<template>
  <div class="flex flex-col gap-3">
    <DtTextarea
      v-model="formula"
      label="公式"
      mono
      autosize
      required
      :error="props.formulaError"
      :maxlength="FORMULA_MAX"
      hint="引用本表的列写作 {列标识}，如 {进水量} - {出水量}。"
    />
    <DtNotice intent="info" icon="alert-circle">
      带函数目录、实时校验与分段编辑的公式编辑器随后续期次接进来。在那之前这里
      只是一行文本：写错了要等保存时后端回一句「公式写不通」才看得到。
    </DtNotice>
  </div>
</template>
