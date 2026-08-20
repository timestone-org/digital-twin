<script setup lang="ts">
/**
 * @fileoverview 素材详情：大图 / 三维预览、元信息、就地改名，以及复制、下载、删除。
 *
 * ⚠ 改名做成就地编辑而不是再开一个弹窗：叠在弹窗之上的弹窗必须调高 `layer`，
 * 而同层时谁在上只由 body 里的先后决定——那条路径极易变成「点了改名没反应」。
 * ⚠ 删除的二次确认走全局宿主（`layer="confirm"`，z 比本弹窗高），故可以从这里问。
 */
import { DtButton, DtField, DtInput, DtModal } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { Asset } from '@/api/assets'
import { formatDateTime } from '@/utils/datetime'
import { formatSize } from '@/utils/filesize'
import AssetPreviewStage from './AssetPreviewStage.vue'

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
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  rename: [name: string]
  copy: []
  download: []
  remove: []
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

/** 元信息表。收成一份数组是为了让模板只有一层 v-for，而不是七段重复标记。 */
const facts = computed<readonly { label: string; value: string }[]>(() => {
  const asset = props.asset
  if (asset === null) return []
  return [
    { label: '类型', value: props.kindLabel },
    { label: '大小', value: formatSize(asset.sizeBytes) },
    { label: '内容类型', value: asset.contentType },
    { label: '上传时间', value: formatDateTime(asset.createdAt) },
    { label: '上传人', value: asset.createdBy },
    { label: '校验和', value: asset.checksum },
    { label: '引用', value: asset.ref },
  ]
})

function close(): void {
  emit('update:modelValue', false)
}

function submit(): void {
  if (!isDirty.value || nameError.value !== '') return
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
    <div v-if="asset" class="dt-asset-detail">
      <AssetPreviewStage :asset="asset" />

      <DtField
        v-if="canManage"
        label="显示名"
        :error="nameError"
        hint="只改库里的名字，字节与引用都不动，用它的大屏无感"
      >
        <div class="dt-asset-detail__rename">
          <DtInput
            v-model="draft"
            :error="nameError"
            :maxlength="MAX_NAME_LEN"
            @enter="submit"
          />
          <DtButton :disabled="!isDirty || nameError !== ''" @click="submit">
            保存
          </DtButton>
        </div>
      </DtField>

      <dl class="dt-asset-detail__facts">
        <div v-for="fact in facts" :key="fact.label">
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
        </div>
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

<style scoped lang="scss">
.dt-asset-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;

  &__rename {
    display: flex;
    align-items: flex-start;
    gap: 8px;

    // DtInput 自己不撑开，不给 flex 的话它会缩成一个几十像素的框
    :first-child {
      flex: 1;
    }
  }

  &__facts {
    display: grid;
    padding: 0;
    margin: 0;
    gap: 8px 24px;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));

    div {
      display: flex;
      min-width: 0;
      gap: 8px;
    }

    dt {
      flex: none;
      color: var(--text-secondary);
    }

    dd {
      overflow: hidden;
      margin: 0;
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-size: var(--ctl-hint-fs-md);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}
</style>
