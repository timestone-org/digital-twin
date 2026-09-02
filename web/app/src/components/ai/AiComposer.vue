<script setup lang="ts">
/**
 * @fileoverview 助手的输入区：一个集成输入框——附件、草稿、模型选择、发送/停止
 * 全在同一个框里，壳是共用的 AiInputBox。
 *
 * ⚠ 附件解析完挂成**待发条目**而不是灌进草稿：一张两百行的表摊进输入框，
 * 草稿就没法编辑了。每一条点开能看全文——用户仍然先看见助手将要看到什么，
 * 发送时才并进那句话（features/ai/attachment.ts）。
 *
 * ⚠ 键位判定在 features/ai/composeKeys.ts，这里只接线。
 */
import { computed, ref } from 'vue'
import type { AssistantModelProfile } from '@dt/contracts'
import { DtButton, DtFilePicker, DtNotice, DtTextarea } from '@dt/ui'

import { parseAttachment } from '@/api/assistant'
import AiAttachmentChip from '@/components/ai/AiAttachmentChip.vue'
import AiInputBox from '@/components/ai/AiInputBox.vue'
import AiModelPicker from '@/components/ai/AiModelPicker.vue'
import type { ComposeState, ModelChoice } from '@/composables/useAiPanel'
import {
  acceptOf,
  imagesOf,
  looksLikeImage,
  toBase64,
  toPending,
  toPendingImage,
  withAttachments,
} from '@/features/ai/attachment'
import { composeKeyOf } from '@/features/ai/composeKeys'

const props = defineProps<{
  /** 草稿与附件。由 useAiPanel 持有：面板收起就卸载，敲了一半的话不能跟着没。 */
  compose: ComposeState
  /** 正在跑回合：发送让位给停止。 */
  running: boolean
  /**
   * 助手正等着用户在卡片上回答。
   * ⚠ 这期间输入框上锁：不锁的话用户的新消息会与正在跑的回合抢同一条时间线，
   * 两个回合同时往里写，谁后到谁覆盖。要用打字，先点卡片上的「我自己说」。
   */
  asking?: boolean | undefined
  /** 摆在输入框上方的一句提醒，各页面自己给。 */
  hint?: string | undefined
  /** 草稿为空时按 ↑ 召回的上一句话；null = 没得召回。 */
  lastSaid?: string | null | undefined
  /** 这套部署接了哪几路模型。只有一路时下拉整个不渲染（AiModelPicker 管）。 */
  models?: readonly AssistantModelProfile[] | undefined
  /** 这个会话选了哪一路。 */
  choice?: ModelChoice | undefined
  /** 附件收哪些后缀，服务端下发。空表时退到兜底名单。 */
  attachmentSuffixes?: readonly string[] | undefined
}>()

const emit = defineEmits<{
  send: [text: string, images: string[]]
  stop: []
  pick: [value: ModelChoice]
}>()

const canSend = computed(
  () =>
    !props.running &&
    props.asking !== true &&
    (props.compose.draft.value.trim() !== '' ||
      props.compose.attachments.value.length > 0),
)

const accept = computed(() => acceptOf(props.attachmentSuffixes ?? []))

function send(): void {
  if (!canSend.value) return
  const pending = props.compose.attachments.value
  // 文本类并进那句话，图片类单独走：图要进视觉档的图片块，摊成文字就没了
  const text = withAttachments(props.compose.draft.value, pending)
  const images = imagesOf(pending)
  props.compose.setDraft('')
  props.compose.setAttachments([])
  emit('send', text, images)
}

function onKeydown(event: KeyboardEvent): void {
  const action = composeKeyOf(event, props.compose.draft.value.trim() !== '')
  if (action === 'send') {
    event.preventDefault()
    send()
    return
  }
  if (action === 'recall' && typeof props.lastSaid === 'string') {
    event.preventDefault()
    props.compose.setDraft(props.lastSaid)
  }
}

const attaching = ref(false)
const attachError = ref('')
/** 点开在看全文的那一条附件；null = 都收着。 */
const previewAt = ref<number | null>(null)

async function attach(files: File[]): Promise<void> {
  const file = files[0]
  if (file === undefined) return
  attaching.value = true
  attachError.value = ''
  try {
    // 图不上传去解析：它是几兆字节，上去再原样下来纯属浪费——手里本来就有
    // 那份字节。收不收由服务端在 :advance 那条路上按字节判
    const base64 = await toBase64(file)
    const one = looksLikeImage(file.name)
      ? toPendingImage(file, base64)
      : toPending(file.name, await parseAttachment(file.name, base64))
    props.compose.setAttachments([...props.compose.attachments.value, one])
  } catch (error) {
    attachError.value =
      error instanceof Error ? error.message : '读不了这个文件'
  } finally {
    attaching.value = false
  }
}

function removeAt(at: number): void {
  props.compose.setAttachments(
    props.compose.attachments.value.filter((_, index) => index !== at),
  )
  previewAt.value = null
}

/** DtTextarea 暴露出来的那一格。⚠ 用结构类型而不是 InstanceType：组件实例
 * 类型 eslint 的 TS 解析不动，focus 那一下会被判成 unsafe call。 */
const box = ref<{ textareaEl: HTMLTextAreaElement | null } | null>(null)

/** 让外面（开场提示点进来时）能把焦点放回输入框。 */
function focusInput(): void {
  box.value?.textareaEl?.focus()
}

defineExpose({ focusInput })
</script>

<template>
  <form class="ai-compose" @submit.prevent="send">
    <p v-if="hint" class="ai-compose__hint">{{ hint }}</p>

    <DtNotice v-if="attachError" intent="danger">{{ attachError }}</DtNotice>

    <AiInputBox
      :running="running"
      :can-send="canSend"
      @send="send"
      @stop="emit('stop')"
    >
      <!-- 有待发附件才给槽：给了空槽壳上也会多出一条空的附件区 -->
      <template v-if="compose.attachments.value.length > 0" #files>
        <AiAttachmentChip
          v-for="(one, index) in compose.attachments.value"
          :key="`${index}:${one.name}`"
          :attachment="one"
          :expanded="previewAt === index"
          @toggle="previewAt = previewAt === index ? null : index"
          @remove="removeAt(index)"
        />
      </template>

      <DtTextarea
        ref="box"
        :model-value="compose.draft.value"
        :rows="2"
        autosize
        :disabled="asking === true"
        :placeholder="
          asking === true ? '先回答上面那个问题…' : '说说你想做什么…'
        "
        aria-label="对助手说"
        @update:model-value="compose.setDraft"
        @keydown="onKeydown"
      />

      <template #tools>
        <DtFilePicker
          :accept="accept"
          :disabled="attaching"
          @select="(files) => void attach(files)"
        >
          <template #default="{ open }">
            <DtButton
              variant="ghost"
              intent="neutral"
              size="sm"
              icon="paperclip"
              :loading="attaching"
              aria-label="附一份参考文件"
              title="附文件或图片：表格附成竖线表，图只这一轮看得见"
              @click="open"
            />
          </template>
        </DtFilePicker>

        <AiModelPicker
          v-if="models !== undefined && choice !== undefined"
          :models="models"
          :choice="choice"
          @pick="(value) => emit('pick', value)"
        />
      </template>
    </AiInputBox>
  </form>
</template>

<style scoped lang="scss">
.ai-compose {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem 0.75rem;
  background: var(--surface-raised);
}

/* 与标题栏同款的发光细线，摆在上沿（--ai-edge 声明在面板根上） */
.ai-compose::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: var(--ai-edge);
}

.ai-compose__hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
}
</style>
