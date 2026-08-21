<script setup lang="ts">
/**
 * @fileoverview 素材详情：大图 / 三维预览、元信息、就地改名，以及复制、下载、删除。
 *
 * ⚠ 改名做成就地编辑而不是再开一个弹窗：叠在弹窗之上的弹窗必须调高 `layer`，
 * 而同层时谁在上只由 body 里的先后决定——那条路径极易变成「点了改名没反应」。
 * ⚠ 保存键挂在 `DtInput` 的 `trailing` 插槽里，不做输入框的兄弟节点：`DtInput`
 * 自带 `DtField`（标签 + 提示 + 控件三行），兄弟节点对齐的是整个字段而不是控件
 * 那一行，于是按钮永远和输入框错开半行。
 * ⚠ 元信息整块**一个字号**（`text-sm`）：标签与值分两档时，14px 的标签压着
 * 11px 的等宽值，看着像标题压脚注（同 `WriteValueDialog` 的写法）。
 * ⚠ 删除的二次确认走全局宿主（`layer="confirm"`，z 比本弹窗高），故可以从这里问。
 */
import { DtButton, DtInput, DtModal, DtTag } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { Asset } from '@/api/assets'
import { formatDateTime } from '@/utils/datetime'
import { formatSize } from '@/utils/filesize'
import AssetPreviewStage from './AssetPreviewStage.vue'
import AssetVariantList from './AssetVariantList.vue'

/** 显示名的长度上限。⚠ 与服务端 `AssetName` 的 128 同值，两边分叉就是「存不进去却不说为什么」。 */
const MAX_NAME_LEN = 128

const props = defineProps<{
  modelValue: boolean
  /** 正在看的素材；关着时为 null。 */
  asset: Asset | null
  /** 持 `asset:manage` 才给改名与删除。 */
  canManage: boolean
  /** 类型的中文标签，取服务端目录。 */
  kindLabel: string
  /** 重压请求在途。 */
  isRecompressing: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  rename: [name: string]
  copy: []
  download: []
  remove: []
  recompress: []
}>()

const draft = ref('')

const trimmed = computed(() => draft.value.trim())
const isDirty = computed(
  () => props.asset !== null && trimmed.value !== props.asset.name,
)
const nameError = computed(() => {
  if (trimmed.value === '') return '名字不能为空'
  return trimmed.value.length > MAX_NAME_LEN
    ? `不许超过 ${MAX_NAME_LEN} 个字`
    : ''
})
/** 改过、且改得合法，才有得存。 */
const canSave = computed(() => isDirty.value && nameError.value === '')

function close(): void {
  emit('update:modelValue', false)
}

function submit(): void {
  if (!canSave.value) return
  emit('rename', trimmed.value)
}

// 每次换素材或重新打开都把草稿拉回真值：留着上一个的名字，用户一按保存就会
// 把这个素材改成上一个的名字，而两边都不会报错
watch(
  () => [props.modelValue, props.asset?.id] as const,
  () => (draft.value = props.asset?.name ?? ''),
  { immediate: true },
)
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="asset?.name ?? '素材详情'"
    width="52rem"
    :dirty="isDirty"
    @update:model-value="close"
  >
    <div v-if="asset" class="flex flex-col gap-4">
      <AssetPreviewStage :asset="asset" />

      <DtInput
        v-if="canManage"
        v-model="draft"
        label="显示名"
        :error="nameError"
        hint="只改库里的名字，字节与引用都不动，用它的大屏无感"
        :maxlength="MAX_NAME_LEN"
        @enter="submit"
      >
        <!-- 改过才出现：没改的时候摆一颗灰按钮，用户还得先分辨它为什么是灰的 -->
        <template v-if="isDirty" #trailing>
          <DtButton
            size="sm"
            variant="ghost"
            icon="check"
            :disabled="!canSave"
            aria-label="保存新名字"
            title="保存新名字（回车同效）"
            @click="submit"
          />
        </template>
      </DtInput>

      <AssetVariantList
        v-if="asset.kind === 'model'"
        :variants="asset.variants"
        :original-bytes="asset.sizeBytes"
        :can-manage="canManage"
        :is-busy="isRecompressing"
        @recompress="emit('recompress')"
      />

      <!-- ⚠ 引用与校验和 `break-all` 整串铺开、不省略：出问题时要拿它去大屏配置
           里逐字搜，截断的一串既搜不了也复制不全 -->
      <dl class="m-0 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-text-secondary">类型</dt>
        <dd class="m-0">{{ kindLabel }}</dd>
        <dt class="text-text-secondary">大小</dt>
        <dd class="m-0">{{ formatSize(asset.sizeBytes) }}</dd>
        <dt class="text-text-secondary">内容类型</dt>
        <dd class="m-0">
          <DtTag mono size="sm">{{ asset.contentType }}</DtTag>
        </dd>
        <dt class="text-text-secondary">上传</dt>
        <dd class="m-0">
          {{ formatDateTime(asset.createdAt) }} · {{ asset.createdBy }}
        </dd>
        <dt class="text-text-secondary">引用</dt>
        <dd class="m-0 break-all font-mono">{{ asset.ref }}</dd>
        <dt class="text-text-secondary">校验和</dt>
        <dd class="m-0 break-all font-mono">{{ asset.checksum }}</dd>
      </dl>
    </div>

    <template #footer>
      <DtButton variant="ghost" icon="copy" @click="emit('copy')">
        复制引用
      </DtButton>
      <DtButton variant="ghost" icon="download" @click="emit('download')">
        下载原件
      </DtButton>
      <DtButton
        v-if="canManage"
        variant="ghost"
        intent="danger"
        icon="trash"
        @click="emit('remove')"
      >
        删除
      </DtButton>
      <DtButton variant="outline" intent="neutral" @click="close">
        关闭
      </DtButton>
    </template>
  </DtModal>
</template>
