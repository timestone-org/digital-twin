<script setup lang="ts">
/**
 * @fileoverview 原件预览的文本画法：纯文本、日志、JSON 与 Markdown。
 *
 * ⚠ 一处 `v-html` 都没有：Markdown 交给 `DtMarkdown`（它整棵树都是文本节点），
 * 其余进 `<pre>`。原件是用户传上来的，摊开它的任何一条路都不许经过 innerHTML。
 * ⚠ JSON 排一次版再摆：一行几万字的 JSON 摊在 `<pre>` 里，横滚条会长到
 * 拖不动，而那与「这份文件是坏的」长得很像。排不出版就原样摆，不报错——
 * 排不出版本身不是错，只是它不是合法 JSON。
 */
import { computed } from 'vue'
import { DtMarkdown } from '@dt/ui'

const props = defineProps<{ text: string; kind: 'markdown' | 'text' }>()

/** JSON 缩进的空格数。 */
const JSON_INDENT = 2

const shown = computed(() => prettyJson(props.text))

/**
 * 是 JSON 就排一次版，不是就原样回。
 * @param text 原文
 */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, JSON_INDENT)
  } catch {
    return text
  }
}
</script>

<template>
  <div class="doc-text">
    <DtMarkdown v-if="props.kind === 'markdown'" :text="props.text" />
    <pre v-else>{{ shown }}</pre>
  </div>
</template>

<style scoped lang="scss">
.doc-text {
  min-height: 0;
  flex: 1;
  padding: 16px 20px;
  overflow: auto;
  background: var(--surface-panel);

  pre {
    margin: 0;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    line-height: 1.6;
    // ⚠ 折行而不是横滚：一份日志里总有几行特别长，为它们留一条贯穿整页的
    // 横滚条会让其余每一行都读不顺
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
</style>
