<script setup lang="ts">
/**
 * @fileoverview 行内片段的渲染：粗体、斜体、删除线、行内代码、链接。
 *
 * ⚠ 一律渲染成**文本节点**，一处 `v-html` 都没有。正文里随时可能出现一个裸
 * `<`，或者一整段复读回来的 HTML——走 `v-html` 的话那就是一个直通的
 * XSS 落点。
 *
 * ⚠ 外链一律 `rel="noopener noreferrer"`：不带的话新开的那一页能通过
 * `window.opener` 把本页导航走。
 */
import type { MdSpan } from './inline'

defineProps<{ spans: readonly MdSpan[] }>()
</script>

<template>
  <span class="md-spans">
    <!-- ⚠ key 是「位置 + 种类」：行内片段没有身份，位置**就是**它的身份，
         而每一片都是无状态的纯渲染。用别的做 key 反而会让流式逐字长的那一条
         每来一个字就整段重建 -->
    <template v-for="(span, at) in spans" :key="`${at}-${span.kind}`">
      <code v-if="span.kind === 'code'" class="md-code">{{ span.text }}</code>
      <a
        v-else-if="span.kind === 'link'"
        :href="span.href"
        target="_blank"
        rel="noopener noreferrer"
      >
        <MarkdownSpans :spans="span.spans" />
      </a>
      <strong v-else-if="span.kind === 'strong'">
        <MarkdownSpans :spans="span.spans" />
      </strong>
      <em v-else-if="span.kind === 'em'">
        <MarkdownSpans :spans="span.spans" />
      </em>
      <del v-else-if="span.kind === 'del'">
        <MarkdownSpans :spans="span.spans" />
      </del>
      <template v-else>{{ span.text }}</template>
    </template>
  </span>
</template>

<style scoped lang="scss">
.md-spans {
  /* ⚠ 必须是 inline：块级会让「粗体」独占一行 */
  display: inline;
}

.md-code {
  padding: 0.05em 0.3em;
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
  color: var(--text-title);
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
  word-break: break-all;
}

a {
  color: var(--accent-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
