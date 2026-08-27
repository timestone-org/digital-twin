/**
 * @fileoverview 调色板 → 画布拖放那半张契约：dataTransfer 用哪个类型、载荷装什么。
 * 拖出的一侧（`NodePalette.vue`）与接住的一侧（画布）各写一份字面量的话，改一处就
 * 悄悄拖不出东西来——拖到画布上什么都不发生，且零报错。
 */

/**
 * 载荷是节点样式 id。
 * ⚠ 用自定义 MIME 而不是 `text/plain`：后者会让从别处拖进来的任意文本都被当成一次
 * 「新建节点」尝试，而落地的会是一个样式悬空、整个画不出来的节点。
 */
export const TWIN_2D_STYLE_DRAG_MIME = 'application/x-twin2d-style-id'
