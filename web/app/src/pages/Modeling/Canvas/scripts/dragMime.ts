/**
 * @fileoverview 从算子面板往画布上拖时用的自定义 MIME。
 *
 * ⚠ 不认 `text/plain`：认了的话，从浏览器别处、从别的应用里拖进来的任意一段
 * 文本都会被当成一次「添加算子」，落下一个 code 是乱码的节点。
 */

export const OPERATOR_MIME = 'application/x-dt-modeling-operator'
