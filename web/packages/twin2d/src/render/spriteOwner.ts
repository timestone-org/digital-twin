/**
 * @fileoverview 同一 DOM 文档内的 2D 图标 sprite 所有权协调，支持已挂载舞台间转移。
 */
import { ref, type Ref } from 'vue'

interface SpriteOwnerState {
  isOwner: Ref<boolean>
  isReleased: boolean
}

interface SpriteRegistry {
  owners: SpriteOwnerState[]
}

/** 一次 sprite 所有权声明。 */
export interface Twin2dSpriteClaim {
  isOwner: Ref<boolean>
  release: () => void
}

// ⚠ 状态必须挂在 Document；同页的编辑器与运行态可能来自两份 bundle。
const REGISTRY_KEY = Symbol.for('@dt/twin2d/sprite-owner-registry')

function isRegistry(value: unknown): value is SpriteRegistry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const owners: unknown = Reflect.get(value, 'owners')
  return Array.isArray(owners)
}

/**
 * 读取或创建文档级声明队列。
 * @param hostDocument sprite 所在的 DOM 文档
 */
function registryOf(hostDocument: Document): SpriteRegistry {
  const stored: unknown = Reflect.get(hostDocument, REGISTRY_KEY)
  if (isRegistry(stored)) return stored
  const registry: SpriteRegistry = { owners: [] }
  Reflect.defineProperty(hostDocument, REGISTRY_KEY, {
    value: registry,
    configurable: true,
  })
  return registry
}

/**
 * 释放当前声明，并把所有权交给仍挂载的下一项。
 * @param hostDocument sprite 所在的 DOM 文档
 * @param owner 待释放的声明
 */
function releaseOwner(hostDocument: Document, owner: SpriteOwnerState): void {
  if (owner.isReleased) return
  owner.isReleased = true
  owner.isOwner.value = false
  const stored: unknown = Reflect.get(hostDocument, REGISTRY_KEY)
  if (!isRegistry(stored)) return
  const current = stored.owners
  const index = current.indexOf(owner)
  if (index >= 0) current.splice(index, 1)
  const next = current[0]
  if (next === undefined) Reflect.deleteProperty(hostDocument, REGISTRY_KEY)
  else next.isOwner.value = true
}

/**
 * 在一个 DOM 文档中声明 sprite 使用权；同时只有最早的存活声明是所有者。
 * @param hostDocument sprite 所在的 DOM 文档
 */
export function claimTwin2dSprite(hostDocument: Document): Twin2dSpriteClaim {
  const current = registryOf(hostDocument).owners
  const owner: SpriteOwnerState = {
    isOwner: ref(current.length === 0),
    isReleased: false,
  }
  current.push(owner)
  return {
    isOwner: owner.isOwner,
    release: () => releaseOwner(hostDocument, owner),
  }
}
