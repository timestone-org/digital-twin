<script setup lang="ts">
/**
 * @fileoverview markdown 渲染器：把一段文字摆成真实节点。用在助手对话、
 * 说明文案这类**内容**上，而不是数据视图上。
 *
 * ⚠ 它**递归引用自己**（列表项与引用里还可能有块）。Vue 的单文件组件按文件名
 * 自引用，所以模板里的 `<DtMarkdown>` 指的就是这一份。
 *
 * ⚠ 一处 `v-html` 都没有：全部内容走文本节点，正文里的 `<script>` 只会原样
 * 显示成几个字。因此它渲染不可信文字是安全的。
 */
import { computed } from 'vue'

import MarkdownTable from './MarkdownTable.vue'
import MarkdownSpans from './MarkdownSpans.vue'
import { parseMarkdown, type MdBlock } from './blocks'

const props = defineProps<{
  /** 原文。给了 `blocks` 时忽略它。 */
  text?: string
  /** 已经解好的块，递归渲染时用。 */
  blocks?: readonly MdBlock[]
}>()

const rendered = computed<readonly MdBlock[]>(
  () => props.blocks ?? parseMarkdown(props.text ?? ''),
)

/** 标题一律降两级渲染：面板里的一段回答不该抢页面标题的层级。 */
function headingTag(level: number): string {
  return `h${String(Math.min(level + 2, 6))}`
}
</script>

<template>
  <div class="md">
    <!-- ⚠ key 是「位置 + 种类」：块没有别的身份，位置**就是**它的身份，
         而每一块都是无状态的纯渲染。流式逐字长的那一条只会改最后一块 -->
    <template v-for="(block, at) in rendered" :key="`${at}-${block.kind}`">
      <component
        :is="headingTag(block.level)"
        v-if="block.kind === 'heading'"
        class="md__heading"
      >
        <MarkdownSpans :spans="block.spans" />
      </component>
      <p v-else-if="block.kind === 'paragraph'" class="md__p">
        <MarkdownSpans :spans="block.spans" />
      </p>
      <pre
        v-else-if="block.kind === 'code'"
        class="md__pre"
        :data-lang="block.lang"
      ><code>{{ block.text }}</code></pre>
      <hr v-else-if="block.kind === 'rule'" class="md__rule" />
      <MarkdownTable
        v-else-if="block.kind === 'table'"
        :head="block.head"
        :rows="block.rows"
      />
      <blockquote v-else-if="block.kind === 'quote'" class="md__quote">
        <DtMarkdown :blocks="block.blocks" />
      </blockquote>
      <ol v-else-if="block.ordered" class="md__list" :start="block.start">
        <li v-for="(item, row) in block.items" :key="`i${row}`">
          <DtMarkdown :blocks="item" />
        </li>
      </ol>
      <ul v-else class="md__list">
        <li v-for="(item, row) in block.items" :key="`i${row}`">
          <DtMarkdown :blocks="item" />
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped lang="scss">
.md {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
}

.md__p {
  margin: 0;
  /* ⚠ 段落里的换行要留着：模型分行写的「第一步…第二步…」吃掉换行会挤成一坨 */
  white-space: pre-wrap;
  word-break: break-word;
}

.md__heading {
  margin: 0.25rem 0 0;
  color: var(--text-title);
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
}

.md__pre {
  margin: 0;
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  /* 宽代码在自己的框里横向滚，不许把面板撑宽 */
  overflow-x: auto;
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  line-height: 1.5;
}

.md__list {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.md__quote {
  margin: 0;
  padding: 0.125rem 0 0.125rem 0.625rem;
  border-left: 2px solid var(--border-default);
  color: var(--text-secondary);
}

.md__rule {
  margin: 0.25rem 0;
  border: 0;
  border-top: 1px solid var(--border-subtle);
}
</style>
