<script setup lang="ts">
/**
 * @fileoverview markdown 表格的渲染。单独一个组件是为了模板嵌套不越界——
 * 表格自己就要五层，塞回块渲染器里会把整棵模板压过上限。
 *
 * ⚠ 它**不是** `DtTable`：那一个是数据视图（列定义、排序、空态、sticky 表头），
 * 而这里的表格是**正文里的一段散文**，格子里装的是行内片段。用数据视图渲染
 * 一段正文，读起来像把一句话塞进了报表。
 *
 * ⚠ 宽表必须**在自己的容器里横向滚动**：不滚的话它会把外面那一栏撑宽，
 * 而面板是定宽的，撑宽的后果是右边一截永远看不见。
 */
import MarkdownSpans from './MarkdownSpans.vue'
import type { MdSpan } from './inline'

defineProps<{ head: readonly MdSpan[][]; rows: readonly MdSpan[][][] }>()
</script>

<template>
  <div class="md-table">
    <table>
      <thead>
        <tr>
          <th v-for="(cell, at) in head" :key="`h${at}`">
            <MarkdownSpans :spans="cell" />
          </th>
        </tr>
      </thead>
      <tbody>
        <!-- ⚠ key 用位置：表格的行列没有别的身份，而每一格都是无状态的 -->
        <tr v-for="(row, at) in rows" :key="`r${at}`">
          <td v-for="(cell, column) in row" :key="`c${column}`">
            <MarkdownSpans :spans="cell" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped lang="scss">
.md-table {
  overflow-x: auto;
  margin: 0.5rem 0;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.8125rem;
}

th,
td {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--border-subtle);
  text-align: left;
  white-space: nowrap;
}

th {
  background: var(--surface-raised);
  color: var(--text-title);
  font-weight: 600;
}
</style>
