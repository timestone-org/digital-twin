<script setup lang="ts">
/**
 * @fileoverview 报告编辑器外壳：Umo 主题映射与纸面排版，数值与 Word 生成器一一对应
 * （services/typography.py、table_layout.py、chart_theme.py）。
 */
import { computed } from 'vue'
import type { ReportPage } from '@dt/contracts'
import { paperFontStack, REPORT_DEFAULT_PAGE } from '../scripts/paperFont'
import { REPORT_TABLE_COLORS } from '../scripts/reportChartTheme'
const props = defineProps<{ page: ReportPage }>()
const paperStyle = computed(() => ({
  '--report-body-font': paperFontStack(
    props.page.font_family ?? REPORT_DEFAULT_PAGE.fontFamily,
  ),
  '--report-body-size': `${props.page.font_size_pt ?? REPORT_DEFAULT_PAGE.fontSizePt}pt`,
  '--report-table-border': REPORT_TABLE_COLORS.border,
  '--report-table-head': REPORT_TABLE_COLORS.head,
  '--report-table-zebra': REPORT_TABLE_COLORS.zebra,
}))
</script>

<template>
  <div class="umo-dt-theme" :style="paperStyle">
    <slot />
  </div>
</template>

<style lang="scss">
.umo-dt-theme {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--card-border);
  border-radius: var(--card-radius);
  --umo-container-background: var(--surface-base);
  --umo-color-white: var(--surface-panel);
  --umo-color-black: var(--text-primary);
  --umo-button-hover-background: var(--surface-raised);
  --umo-mask-color: var(--surface-overlay);
  --umo-shadow: var(--fx-shadow-menu);
  --umo-font-family: var(--font-sans);
  --td-font-family: var(--font-sans);
  --umo-text-color: var(--text-primary);
  --umo-text-color-light: var(--text-secondary);
  --umo-text-color-disabled: var(--text-disabled);
  --umo-border-color: var(--border-default);
  --umo-border-color-light: var(--border-subtle);
  --umo-border-color-dark: var(--border-strong);
  --umo-primary-color: var(--accent-primary);
  --umo-error-color: var(--state-danger);
  --umo-warning-color: var(--state-warning);
  --umo-radius: var(--radius-sm);
  --umo-radius-medium: var(--radius-md);
  --umo-scrollbar-thumb-color: var(--border-default);
  --umo-scrollbar-thumb-hover-color: var(--border-hover);
}

.umo-dt-theme > * {
  height: 100%;
}

.umo-dt-theme .umo-page-content {
  color: var(--fx-const-ink);
  background: var(--fx-const-paper);
}

.umo-dt-theme .umo-editor-content .umo-editor {
  font-family: var(--report-body-font);
  font-size: var(--report-body-size);
  line-height: 1.65;
}

/* 以下数值与 services/typography.py、table_layout.py 逐项对应。 */
.umo-dt-theme .umo-editor-content .umo-editor > * + *:not(.umo-floating-node) {
  margin-top: 6pt;
}

.umo-dt-theme .umo-editor-content :is(h1, h2, h3, h4, h5, h6) {
  color: var(--fx-const-ink);
  font-weight: 700;
  line-height: 1.4;
}

.umo-dt-theme .umo-editor-content .umo-editor > :is(h1, h2) {
  margin-top: 16pt;
}

.umo-dt-theme .umo-editor-content .umo-editor > :is(h3, h4, h5, h6) {
  margin-top: 10pt;
}

.umo-dt-theme .umo-editor-content h1 {
  font-size: 18pt;
}

.umo-dt-theme .umo-editor-content h2 {
  font-size: 15pt;
}

.umo-dt-theme .umo-editor-content h3 {
  font-size: 13pt;
}

.umo-dt-theme .umo-editor-content h4 {
  font-size: 12pt;
}

.umo-dt-theme .umo-editor-content :is(h5, h6) {
  font-size: 11pt;
}

/* Word 把正文第一段一级标题设为「标题」样式：22pt 居中。 */
.umo-dt-theme .umo-editor-content .umo-editor > h1:first-child {
  margin-top: 0;
  margin-bottom: 8pt;
  font-size: 22pt;
  text-align: center;
}

.umo-dt-theme .umo-status-bar {
  height: auto;
  min-height: 30px;
  flex-shrink: 0;
  flex-wrap: wrap;
  row-gap: 4px;
}

.umo-dt-theme .umo-status-bar-left,
.umo-dt-theme .umo-status-bar-right {
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
}
</style>

<style lang="scss">
.umo-dt-theme .report-data-node {
  display: inline-block;
  max-width: 100%;
  padding: 0.15em 0.55em;
  margin: 0.15em;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  background: var(--surface-panel);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 0.9em;
  cursor: pointer;
  white-space: normal;
  overflow-wrap: anywhere;
  &[data-report-node='condText'] {
    border-style: dashed;
  }
  &.report-data-block {
    display: block;
    padding: 1.25em;
    margin: 0.75em 0;
    border-left-width: 4px;
  }
  &[data-report-node='dsTable'] {
    border-style: double;
  }
  &.report-data-node--value {
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    background: transparent;
  }
  &.report-data-node--value:not(.report-data-block) {
    padding: 0;
    margin: 0;
    border: 0;
    border-bottom: 1px dotted var(--accent-primary);
    border-radius: 0;
  }
  &.report-data-block.report-data-node--value {
    padding: 0;
    border: 0;
    border-radius: 0;
  }
  &:hover,
  &:focus-visible,
  &.ProseMirror-selectednode {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }
  &:not(.report-data-node--value):is(
      :hover,
      :focus-visible,
      .ProseMirror-selectednode
    ) {
    background: var(--surface-raised);
  }
}

.umo-dt-theme .report-node-caption {
  font-size: 10.5pt;
  font-weight: 700;
  line-height: 1.4;
  margin-bottom: 6pt;
  &:empty {
    display: none;
  }
}

.umo-dt-theme .report-paper-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 10.5pt;
  line-height: 15pt;
  th,
  td {
    padding: 2pt 5pt;
    border: 0.5pt solid var(--report-table-border);
    vertical-align: middle;
    overflow-wrap: anywhere;
  }
  th {
    background: var(--report-table-head);
    font-weight: 700;
    text-align: center;
  }
  tbody tr:nth-child(even) td {
    background: var(--report-table-zebra);
  }
  td.is-number {
    text-align: right;
  }
}
</style>
