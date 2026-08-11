<script setup lang="ts">
/**
 * @fileoverview DtDigits —— 等宽数字串（时钟、读数），消掉数字跳动带来的宽度抖动。
 */
import { computed } from 'vue'

const props = defineProps<{ value: string }>()

// ⚠ 按 grapheme 而不是码点切：组合字符与 ZWJ emoji 被拆开后会渲染成错乱字形
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 只有 ASCII 数字要锁宽；`:`、`-`、CJK 的宽度本来就是恒定的。 */
function isDigit(cell: string): boolean {
  return cell.length === 1 && cell >= '0' && cell <= '9'
}

const cells = computed(() =>
  [...segmenter.segment(props.value)].map((piece, index) => ({
    key: `${index}-${piece.segment}`,
    cell: piece.segment,
    digit: isDigit(piece.segment),
  })),
)
</script>

<template>
  <span class="dt-digits">
    <!-- ⚠ 读屏读的是这份完整文本，逐字格子整体 aria-hidden：
         ARIA 禁止给无 role 的 generic 元素命名，挂 aria-label 会有 AT 整段读不出来 -->
    <span class="dt-digits__text">{{ value }}</span>
    <span class="dt-digits__cells" aria-hidden="true">
      <span
        v-for="item in cells"
        :key="item.key"
        class="dt-digits__cell"
        :class="{ 'dt-digits__cell--digit': item.digit }"
        >{{ item.cell }}</span
      >
    </span>
  </span>
</template>

<style scoped lang="scss">
.dt-digits {
  white-space: nowrap;

  // 只给 AT 的整串文本。user-select:none 免得复制时同一串出现两遍
  &__text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    user-select: none;
  }

  &__cell {
    display: inline-block;
    // ⚠ inline-block 里孤立的空白会被折叠成零宽，`08:30 周四` 的分隔空格会消失
    white-space: pre;
  }

  // ⚠ 不用 font-variant-numeric: tabular-nums —— 等宽数字是 OpenType 的 tnum 特性，
  // 要字体带 GSUB 表；大屏用的点阵字体没有，那条声明是空转。1ch 等于当前字体 '0'
  // 的推进宽度，把数字逐个塞进去居中即可，且换字体自动跟随。
  &__cell--digit {
    width: 1ch;
    text-align: center;
  }
}
</style>
