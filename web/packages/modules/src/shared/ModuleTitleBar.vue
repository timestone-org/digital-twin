<script setup lang="ts">
/**
 * @fileoverview 全模块统一的标题头：强调竖条 + 标题文字 + 斜纹装饰带 + 右侧插槽。
 * 排版与动效全部走可注入的 `--card-title-*` 变量，每个 `var()` 的兜底值就是平台默认观感——
 * 「没配这一项」与「配成默认值」因此走同一条渲染路径，不会各长一个样。
 */
import { computed } from 'vue'

import { readTrimmedText } from './config'

const props = defineProps<{ title?: string }>()

// ⚠ 判「有没有标题」要看 trim 之后：一串空格会画出一条有竖条、没有字的空标题栏
const heading = computed(() => readTrimmedText(props.title))
</script>

<template>
  <div class="module-title-bar">
    <span v-if="heading !== ''" class="panel-bar" />
    <span v-if="heading !== ''" class="module-title-bar__text">{{
      heading
    }}</span>
    <!-- 45° 斜纹装饰带。缺省 display:none 不占位，且必须排在 #extra 之前，
         否则会把右侧插槽里的控件挤出行尾。纯装饰，读屏跳过。 -->
    <span class="module-title-bar__rule" aria-hidden="true" />
    <span v-if="$slots.extra" class="module-title-bar__extra">
      <slot name="extra" />
    </span>
  </div>
</template>

<style scoped lang="scss">
// flex:none → 作为模块这一列的标题段，占内容高度、不被主体挤压。
// display 也可被顶掉：整条隐藏由 --card-title-display 一处控制。
.module-title-bar {
  position: relative;
  z-index: 2;
  display: var(--card-title-display, flex);
  // 缺省居中；贴底档注入 flex-end，让竖条、文字、装饰带落在同一条底线上
  align-items: var(--card-title-align, center);
  flex: none;
  gap: var(--card-title-gap, 8px);
  padding: var(--card-title-pad, 8px 12px 6px);
}

// 余量分配：缺省 `1 1 0%` 让文字吃满剩余宽度；开了装饰带时注入 `0 1 auto`，
// 文字退回自然宽度把余量让给装饰带，但**仍保留收缩能力**——注入 `none` 会让
// 长标题顶出标题行，而不是走下面的省略号。
.module-title-bar__text {
  overflow: hidden;
  flex: var(--card-title-text-flex, 1 1 0%);
  min-width: 0;
  color: var(--card-title-color, var(--text-title));
  font-size: var(--card-title-size, 13px);
  font-weight: var(--card-title-weight, 600);
  letter-spacing: var(--card-title-ls, 0.025em);
  white-space: nowrap;
  text-overflow: ellipsis;
  text-shadow: var(
    --card-title-shadow,
    0 0 8px var(--fx-glow-title),
    0 0 22px rgba(var(--accent-primary-rgb), 0.15)
  );
  // 缺省 none = 静止。⚠ 动画名由外部注入，keyframes 只能定义在全局样式里：
  // scoped 块里的 @keyframes 会被 Vue 改名加 hash，与注入的名字必然对不上。
  animation-name: var(--card-title-text-anim, none);
  animation-duration: var(--card-title-anim-dur, 3s);
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}

// 强调竖条。形状四要素全部变量化：注入 -h:100% + -align:stretch + -radius:0 + -glow:0
// 就得到「贯穿整行、直角、无辉光」的实心方条。
.panel-bar {
  flex: none;
  width: var(--card-title-bar-w, 3px);
  height: var(--card-title-bar-h, 13px); // 满高要配 -align:stretch 才生效
  // 缺省跟随行容器的对齐，这样只改整行对齐时竖条不会与文字脱节
  align-self: var(--card-title-bar-align, var(--card-title-align, center));
  border-radius: var(--card-title-bar-radius, var(--radius-pill));
  background: var(--card-title-bar, var(--accent-primary));
  box-shadow: 0 0 var(--card-title-bar-glow, 6px)
    var(--card-title-bar, var(--accent-primary));
  animation-name: var(--card-title-anim, none);
  animation-duration: var(--card-title-anim-dur, 3s);
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}

// 纯 CSS 绘制、不引任何图片：本包保持零素材依赖，独立挂载也画得出来。
// 两层背景 = 底部一条实线 + 上方一条斜纹带；把斜纹层注入成 transparent
// 即退化为「只留一条细线」的清淡档。
.module-title-bar__rule {
  display: var(--card-title-rule-display, none);
  flex: 1 1 0%;
  height: var(--card-title-rule-h, 13px);
  margin-bottom: var(--card-title-rule-mb, 5px);
  opacity: var(--card-title-rule-opacity, 0.3);
  background:
    linear-gradient(
        var(--card-title-rule-color, currentColor),
        var(--card-title-rule-color, currentColor)
      )
      left bottom / 100% 1px no-repeat,
    repeating-linear-gradient(
        45deg,
        var(--card-title-rule-hatch, var(--card-title-rule-color, currentColor))
          0,
        var(--card-title-rule-hatch, var(--card-title-rule-color, currentColor))
          1.5px,
        transparent 1.5px,
        transparent 6.3px
      )
      left top / 100% 8px no-repeat;
}

.module-title-bar__extra {
  display: flex;
  align-items: center;
  margin-left: auto;
  gap: 8px;
}
</style>
