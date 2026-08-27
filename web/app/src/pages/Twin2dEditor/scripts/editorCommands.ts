/**
 * @fileoverview 键盘手势的十二个落点：撤销重做、复制剪切粘贴再制、删除、全选、
 * Esc、方向键微调与数字键切工具，各自落到文档态与选中态上。
 * 判定归 `shortcuts.ts`，这里只回答「按下去做什么」。
 *
 * ⚠ 一切改动都走调用方给的 `commit`（= 文档态那个唯一入口）：绕开它写的那一笔不会
 * 重派绑定，而界面上一切照旧、读数照常刷新，只是那之后每一条绑定都接错了对象。
 * ⚠ 剪贴板的现场收在闭包里而不是模块级：模块级那一份在测试之间互相污染，同一个页面
 * 开两个编辑器实例时也会互相踩。
 * ⚠ 连线没有自己的位置（两端定住它），所以方向键对连线那条轴是**一步不动**——
 * 挪它得去挪两端的节点。
 * ⚠ 复制 / 剪切 / 粘贴这一族有**两条轴**：正编着一份节点样式、且图元树上选着一枚时，
 * 这三个键对着的是**图元**，否则对着画布上选中的那一批。判据只有这一处，图元树上那
 * 两枚键也走这里——各写一份的话，键盘与鼠标会在同一份样式上粘出两种结果。
 * ⚠ 粘贴按剪贴板里那份的类别分派，不按当下选中：图元载荷落不进画布，实体载荷也落不
 * 进图元树，认错了只会往文档里塞一堆归一化随后丢掉的东西，而界面上一声不吭。
 */
import type { Pt, Twin2dConfig, Twin2dNodeStyle } from '@dt/twin2d'
import { ref } from 'vue'
import type { Ref } from 'vue'

import {
  createTwin2dClipboard,
  pasteTwin2dEntities,
  pasteTwin2dPrims,
  twin2dCut,
  twin2dEntityClip,
  twin2dPrimClip,
} from './clipboard'
import type {
  Twin2dClipboard,
  Twin2dEntityClip,
  Twin2dPrimClip,
} from './clipboard'
import { duplicateEdges, removeEdges } from './edgeOps'
import type { Twin2dEditorSelection, Twin2dPickKind } from './editorSelection'
import { duplicateMarks, moveMarks, removeMarks } from './markOps'
import { duplicateNodes, moveNodes, removeNodes } from './nodeOps'
import type { Twin2dCopied } from './nodeOps'
import { findTwin2dPrim, removePrim, twin2dPrimIds } from './primOps'
import type { Twin2dShortcutHandlers, Twin2dTool } from './shortcuts'
import { twin2dNodeStyleOf, writeNodeStyle } from './styleOps'

/** 手势落点要的那几样。 */
export interface Twin2dCommandDeps {
  /** 取当前配置；还没读出来时为 null，这时全部手势一步不动。 */
  config: () => Twin2dConfig | null
  /** 两条选中轴。 */
  selection: Twin2dEditorSelection
  /** 写配置的唯一入口（文档态的 `commit`）。 */
  commit: (next: Twin2dConfig) => void
  undo: () => void
  redo: () => void
  save: () => void
  /** 图元树上选中的那一枚；空串 = 一枚都没选，此时剪贴板这一族对着画布。 */
  selectedPrim: () => string
  /** 把图元选中挪到某一枚上；空串 = 取消选中。 */
  pickPrim: (primId: string) => void
}

/** 装好的手势落点，加当前工具。 */
export interface Twin2dCommands {
  handlers: Twin2dShortcutHandlers
  /** 数字键切出来的当前工具。 */
  tool: Ref<Twin2dTool>
}

/** 一次动作的现场：配置、当下这一类与它选中的那一批。 */
interface Twin2dAim {
  config: Twin2dConfig
  kind: Twin2dPickKind
  ids: readonly string[]
}

/** 图元那一路的现场：配置与正编着的那份节点样式。 */
interface Twin2dPrimAim {
  config: Twin2dConfig
  style: Twin2dNodeStyle
}

/** 手势落点的现场；摊成参数会超过五个。 */
interface Ctx {
  deps: Twin2dCommandDeps
  clipboard: Twin2dClipboard
}

/** 一个都没选中时，全选与删除落到哪一类上。 */
const FALLBACK_KIND: Twin2dPickKind = 'nodes'

/** 三类实例的名字，粘贴之后按这个次序挑「选中转到谁身上」。 */
const PICK_KINDS: readonly Twin2dPickKind[] = ['nodes', 'edges', 'marks']

/**
 * 这一手对着谁；配置还没读出来时给 null。
 * @param ctx 现场
 */
function aimOf(ctx: Ctx): Twin2dAim | null {
  const config = ctx.deps.config()
  if (config === null) return null
  const kind = ctx.deps.selection.pick.value?.kind ?? FALLBACK_KIND
  return { config, kind, ids: ctx.deps.selection.idsOf(kind) }
}

/**
 * 复制一批实体，副本按一格栅格错开。
 * ⚠ 连线那一类没有可加的位移（位置由两端定），副本与原件完全重合。
 * @param aim 这一手对着谁
 */
function copyOf(aim: Twin2dAim): Twin2dCopied {
  const step = aim.config.canvas.grid
  const at: Pt = { x: step, y: step }
  if (aim.kind === 'nodes') return duplicateNodes(aim.config, aim.ids, at)
  if (aim.kind === 'marks') return duplicateMarks(aim.config, aim.ids, at)
  return duplicateEdges(aim.config, aim.ids)
}

/**
 * 删掉一批实体。
 * @param aim 这一手对着谁
 */
function removeOf(aim: Twin2dAim): Twin2dConfig {
  if (aim.kind === 'nodes') return removeNodes(aim.config, aim.ids).config
  if (aim.kind === 'marks') return removeMarks(aim.config, aim.ids).config
  return removeEdges(aim.config, aim.ids).config
}

/**
 * 一批实体整体平移；连线一步不动。
 * @param aim 这一手对着谁
 * @param at 位移（设计坐标）
 */
function moveOf(aim: Twin2dAim, at: Pt): Twin2dConfig {
  if (aim.kind === 'nodes') return moveNodes(aim.config, aim.ids, at)
  if (aim.kind === 'marks') return moveMarks(aim.config, aim.ids, at)
  return aim.config
}

/**
 * 图元那一路当下对着谁：正编着的那份**节点**样式；不成立给 null。
 * ⚠ 连线样式那一档没有图元树，所以它不算数：算进来的话在连线样式面上按 ⌘V
 * 会往一份根本画不出图元的样式里塞东西。
 * ⚠ 取的是**当下生效**的那一份（文档里的优先，落不到才回预置库）：喂预置库那一份
 * 会把已有的覆盖整个抹掉，而界面上只表现为「刚才改的几项一起没了」。
 * @param ctx 现场
 */
function primAimOf(ctx: Ctx): Twin2dPrimAim | null {
  const config = ctx.deps.config()
  const focus = ctx.deps.selection.styleFocus.value
  if (config === null || focus === null || focus.kind !== 'styles') return null
  const style = twin2dNodeStyleOf(config, focus.id)
  return style === null ? null : { config, style }
}

/**
 * 把树上选中的那一枚（连子树）打进剪贴板；没在编样式、或一枚都没选就没打，给 false。
 * @param ctx 现场
 */
function copyPrimCmd(ctx: Ctx): boolean {
  const aim = primAimOf(ctx)
  if (aim === null) return false
  const at = findTwin2dPrim(aim.style.prims, ctx.deps.selectedPrim())
  const clip = twin2dPrimClip(at === null ? [] : [at.prim])
  if (clip === null) return false
  ctx.clipboard.write(clip)
  return true
}

/**
 * 剪切树上选中的那一枚。
 * ⚠ 先打包再删：反过来的话删掉的那一枚就再也打不进剪贴板，而这一步零报错——
 * 表现是「剪了一刀，粘不出来」。
 * @param ctx 现场
 */
function cutPrimCmd(ctx: Ctx): boolean {
  const aim = primAimOf(ctx)
  if (aim === null || !copyPrimCmd(ctx)) return false
  ctx.deps.commit(removePrim(aim.config, aim.style, ctx.deps.selectedPrim()))
  ctx.deps.pickPrim('')
  return true
}

/**
 * 把一份图元载荷追加到正编着那份样式的图元树末尾（= 画在最上层），选中转到副本上。
 * ⚠ 深度不必在这里判：载荷本身是归一化过的（上限 6 层，超的那几层已经被丢掉），
 * 落在根层最深也只占满这 6 层。落在别人的子树里那一档另说，那条路走图元树的拖拽。
 * @param ctx 现场
 * @param clip 剪贴板里那份图元载荷
 */
function pastePrimsCmd(ctx: Ctx, clip: Twin2dPrimClip): void {
  const aim = primAimOf(ctx)
  if (aim === null) return
  const pasted = pasteTwin2dPrims({
    list: aim.style.prims,
    clip,
    taken: twin2dPrimIds(aim.style.prims),
  })
  ctx.deps.commit(
    writeNodeStyle(aim.config, { ...aim.style, prims: pasted.list }),
  )
  ctx.deps.pickPrim(pasted.ids.at(-1) ?? '')
}

/**
 * 复制选中的那一批到剪贴板。
 * @param ctx 现场
 */
function copyCmd(ctx: Ctx): void {
  if (copyPrimCmd(ctx)) return
  const aim = aimOf(ctx)
  if (aim === null) return
  const clip = twin2dEntityClip(aim.config, aim.kind, aim.ids)
  if (clip !== null) ctx.clipboard.write(clip)
}

/**
 * 剪切选中的那一批。
 * @param ctx 现场
 */
function cutCmd(ctx: Ctx): void {
  if (cutPrimCmd(ctx)) return
  const aim = aimOf(ctx)
  if (aim === null) return
  const done = twin2dCut(aim.config, aim.kind, aim.ids)
  if (done.clip === null) return
  ctx.clipboard.write(done.clip)
  ctx.deps.commit(done.removal.config)
}

/**
 * 粘一批实体进来，选中转到副本上。
 * ⚠ 三类里挑真有落地的那一类：整批被归一化丢掉时不动选中，否则右栏会停在一个
 * 空壳上，改哪一项都写不回去且不报错。
 * @param ctx 现场
 * @param clip 剪贴板里那份实体载荷
 */
function pasteEntitiesCmd(ctx: Ctx, clip: Twin2dEntityClip): void {
  const config = ctx.deps.config()
  if (config === null) return
  const done = pasteTwin2dEntities({
    config,
    clip,
    offset: ctx.clipboard.nextOffset(config.canvas.grid),
  })
  ctx.deps.commit(done.config)
  const kind = PICK_KINDS.find((item) => done.ids[item].length > 0)
  if (kind !== undefined) {
    ctx.deps.selection.selectMany(kind, done.ids[kind], false)
  }
}

/**
 * 粘一份进来：按载荷自己的类别分派。
 * @param ctx 现场
 */
function pasteCmd(ctx: Ctx): void {
  const clip = ctx.clipboard.read()
  if (clip === null) return
  if (clip.kind === 'prims') return pastePrimsCmd(ctx, clip)
  pasteEntitiesCmd(ctx, clip)
}

/**
 * 就地再制选中的那一批，选中转到副本上。
 * @param ctx 现场
 */
function duplicateCmd(ctx: Ctx): void {
  const aim = aimOf(ctx)
  if (aim === null) return
  const copied = copyOf(aim)
  ctx.deps.commit(copied.config)
  ctx.deps.selection.selectMany(aim.kind, copied.ids, false)
}

/**
 * 删掉选中的那一批。
 * ⚠ 悬空的选中由页面那道 `prune` 摘，不在这里清：删节点会连带删掉挂在它上头的
 * 连线，只清被点名的那一类就会在连线那条轴上留下已经不存在的 id。
 * @param ctx 现场
 */
function removeCmd(ctx: Ctx): void {
  const aim = aimOf(ctx)
  if (aim === null) return
  ctx.deps.commit(removeOf(aim))
}

/**
 * 全选当下这一类。
 * @param ctx 现场
 */
function selectAllCmd(ctx: Ctx): void {
  const aim = aimOf(ctx)
  if (aim === null) return
  ctx.deps.selection.selectMany(
    aim.kind,
    aim.config[aim.kind].map((row) => row.id),
    false,
  )
}

/**
 * 方向键微调。
 * @param ctx 现场
 * @param at 位移（设计坐标）
 */
function nudgeCmd(ctx: Ctx, at: Pt): void {
  const aim = aimOf(ctx)
  if (aim === null) return
  ctx.deps.commit(moveOf(aim, at))
}

/**
 * 装上十二个手势落点。
 * @param deps 文档态、选中轴与页面动作
 */
export function createTwin2dCommands(deps: Twin2dCommandDeps): Twin2dCommands {
  const tool = ref<Twin2dTool>('select')
  const ctx: Ctx = { deps, clipboard: createTwin2dClipboard() }
  return {
    tool,
    handlers: {
      save: deps.save,
      undo: deps.undo,
      redo: deps.redo,
      copy: () => copyCmd(ctx),
      cut: () => cutCmd(ctx),
      paste: () => pasteCmd(ctx),
      duplicate: () => duplicateCmd(ctx),
      remove: () => removeCmd(ctx),
      selectAll: () => selectAllCmd(ctx),
      escape: () => deps.selection.clear(),
      nudge: (at) => nudgeCmd(ctx, at),
      selectTool: (next) => {
        tool.value = next
      },
    },
  }
}
