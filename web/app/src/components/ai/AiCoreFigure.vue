<script setup lang="ts">
/**
 * @fileoverview 机器人本体的那一团 <g>：天线、软壳、脸、眼睛、状态灯。
 * 只是 AiCoreIcon 的下半张图——渐变/滤镜的 defs 与动画样式都在父件里。
 */
const props = defineProps<{
  /** 父件 defs 的 id 前缀（每份实例一个，防同屏串引用）。 */
  uid: string
}>()

/** 指向父件 defs 的 url(#…) 引用。 */
function u(name: string): string {
  return `url(#${props.uid}-${name})`
}
</script>

<template>
  <g class="bot" :filter="u('shadow')">
    <!-- 天线 -->
    <path
      d="M128 53V40"
      stroke="#70EFF7"
      stroke-width="6"
      stroke-linecap="round"
    />
    <circle
      cx="128"
      cy="30"
      r="12"
      fill="#123D50"
      stroke="#7AF2F8"
      stroke-width="4"
    />
    <circle
      class="signal-ring"
      cx="128"
      cy="30"
      r="8"
      stroke="#C7FDFF"
      stroke-width="2.5"
    />
    <circle class="signal-dot" cx="128" cy="30" r="4.5" fill="#E3FFFF" />

    <!-- 两侧圆角模块 -->
    <rect
      x="28"
      y="110"
      width="34"
      height="46"
      rx="17"
      fill="#125D77"
      stroke="#69EAF3"
      stroke-width="4"
    />
    <rect
      x="194"
      y="110"
      width="34"
      height="46"
      rx="17"
      fill="#125D77"
      stroke="#69EAF3"
      stroke-width="4"
    />
    <circle cx="45" cy="133" r="5" fill="#B9FCFF" opacity=".8" />
    <circle cx="211" cy="133" r="5" fill="#B9FCFF" opacity=".8" />

    <!-- 软壳主体 -->
    <rect
      x="45"
      y="49"
      width="166"
      height="168"
      rx="83"
      fill="#06131C"
      stroke="#061018"
      stroke-width="12"
    />
    <rect
      x="45"
      y="49"
      width="166"
      height="168"
      rx="83"
      :fill="u('shell')"
      :stroke="u('shellEdge')"
      stroke-width="4"
    />
    <rect
      x="54"
      y="60"
      width="148"
      height="146"
      rx="73"
      fill="#0B2A3A"
      stroke="#D9FEFF"
      stroke-opacity=".34"
      stroke-width="2.5"
    />

    <!-- 面窗与扫光 -->
    <rect
      x="63"
      y="82"
      width="130"
      height="98"
      rx="49"
      :fill="u('face')"
      stroke="#6AEAF3"
      stroke-width="4"
    />
    <g :clip-path="u('faceClip')">
      <path
        d="M76 95C106 81 153 82 181 97"
        stroke="#E5FFFF"
        stroke-opacity=".13"
        stroke-width="7"
        stroke-linecap="round"
      />
      <rect
        class="shine"
        x="65"
        y="83"
        width="34"
        height="96"
        :fill="u('scanLight')"
      />
    </g>

    <!-- 眼睛 -->
    <g class="eyes" :filter="u('eyeGlow')">
      <rect x="82" y="106" width="36" height="42" rx="18" :fill="u('eye')" />
      <rect x="138" y="106" width="36" height="42" rx="18" :fill="u('eye')" />
      <g class="pupils">
        <ellipse cx="103" cy="130" rx="8" ry="10" fill="#0A4B61" />
        <ellipse cx="159" cy="130" rx="8" ry="10" fill="#0A4B61" />
        <circle cx="106" cy="126" r="3" fill="white" />
        <circle cx="162" cy="126" r="3" fill="white" />
      </g>
    </g>

    <!-- 嘴与状态灯 -->
    <path
      d="M116 162C123 168 133 168 140 162"
      stroke="#7AF1F7"
      stroke-width="3.5"
      stroke-linecap="round"
    />
    <rect
      x="108"
      y="190"
      width="40"
      height="9"
      rx="4.5"
      fill="#08212D"
      stroke="#63E1EA"
      stroke-opacity=".75"
    />
    <circle cx="118" cy="194.5" r="2.2" fill="#B5FBFE" />
    <circle cx="128" cy="194.5" r="2.2" fill="#83F0F6" opacity=".8" />
    <circle cx="138" cy="194.5" r="2.2" fill="#62D9E6" opacity=".55" />
  </g>
</template>
