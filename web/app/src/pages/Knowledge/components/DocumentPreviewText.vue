<script setup lang="ts">
/**
 * @fileoverview 原件预览的文本画法：纯文本、日志、JSON 与 Markdown。
 *
 * ⚠ 一处 `v-html` 都没有：Markdown 交给 `DtMarkdown`（它整棵树都是文本节点），
 * 其余进 `<pre>`。原件是用户传上来的，摊开它的任何一条路都不许经过 innerHTML。
 */
import { computed } from 'vue'
import { DtMarkdown } from '@dt/ui'

const props = defineProps<{
  text: string
  kind: 'markdown' | 'text' | 'json'
}>()

/** JSON 缩进的空格数。 */
const JSON_INDENT = 2

// ⚠ 仅 JSON 文件排版，日志和纯文本即使是合法 JSON 也保留原文。
const shown = computed(() =>
  props.kind === 'json' ? prettyJson(props.text) : props.text,
)

/**
 * 排一次版；排不出来就原样回。
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
