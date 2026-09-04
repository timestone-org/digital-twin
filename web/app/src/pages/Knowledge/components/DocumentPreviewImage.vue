<script setup lang="ts">
/**
 * @fileoverview 原件预览的图片画法：把取回来的字节转成 object URL 摆出来。
 *
 * ⚠ 不能把端点地址直接写进 `<img src>`：浏览器给图片请求带不上
 * `Authorization`，而知识库的原件要认人。写进 src 的表现是一个碎图标，
 * 且不报任何错。
 * ⚠ object URL 卸载时必须 revoke：这块 Blob 不释放就一直挂在文档上，
 * 而知识库页是长时间开着的，翻几份原件就攒下几份整包。
 */
import { onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ blob: Blob; name: string }>()

const src = ref('')

function release(): void {
  if (src.value !== '') URL.revokeObjectURL(src.value)
  src.value = ''
}

watch(
  () => props.blob,
  (blob) => {
    release()
    src.value = URL.createObjectURL(blob)
  },
  { immediate: true },
)

onUnmounted(release)
</script>

<template>
  <div class="doc-image">
    <img v-if="src !== ''" :src="src" :alt="props.name" />
  </div>
</template>

<style scoped lang="scss">
.doc-image {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 12px;
  // 棋盘格：透明的 PNG 在纯色底上看不出哪里是透明的，用户会以为原件自带白底
  background-color: var(--surface-sunken);
  background-image:
    linear-gradient(
      45deg,
      var(--border-subtle) 25%,
      transparent 25% 75%,
      var(--border-subtle) 75%
    ),
    linear-gradient(
      45deg,
      var(--border-subtle) 25%,
      transparent 25% 75%,
      var(--border-subtle) 75%
    );
  background-position:
    0 0,
    8px 8px;
  background-size: 16px 16px;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}
</style>
