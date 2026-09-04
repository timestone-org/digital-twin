<script setup lang="ts">
/**
 * @fileoverview 原件预览的 HTML 画法：把它关进一个沙箱 iframe 里画。
 *
 * ⚠ 这个文件整体是一条**安全边界**，三处都不能松：
 * 1. 用 `srcdoc` 而不是 object URL。`blob:` 地址继承创建它的那个页面的源，
 *    于是那份 HTML 就跑在本站源上，能读这个源的存储、能替用户调接口——
 *    一次上传就是一次存储型 XSS。`srcdoc` 配上沙箱是不透明源。
 * 2. `sandbox` 留**空串**，一个 `allow-` 都不给。给了 `allow-scripts` 脚本就
 *    活了，给了 `allow-same-origin` 源就回来了，两个一起给等于没有沙箱。
 * 3. 不加 `v-html`、不摘 `sandbox`。这一屏画的是用户传上来的字节。
 *
 * ⚠ 代价是它只画得出静态版式：脚本不跑、表单不能提交。这是刻意的——
 * 预览一份资料不需要它能执行。
 */
const props = defineProps<{ text: string; name: string }>()
</script>

<template>
  <iframe
    class="doc-html"
    sandbox=""
    referrerpolicy="no-referrer"
    :title="`${props.name} 的预览`"
    :srcdoc="props.text"
  />
</template>

<style scoped lang="scss">
.doc-html {
  min-height: 0;
  flex: 1;
  width: 100%;
  border: none;
  // ⚠ 白底写死：沙箱里那份 HTML 多半假定自己在白底上，跟着本站主题给深色底
  // 会让一份只设了黑色字的资料变成黑底黑字
  background: var(--fx-const-paper);
}
</style>
