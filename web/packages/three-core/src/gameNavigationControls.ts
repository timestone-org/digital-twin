/**
 * @fileoverview 3D 视口的游戏式操作：Pointer Lock 鼠标转向，键盘六向平移。
 * 相机与 OrbitControls 的 target 始终同步，模式来回切换时不会跳镜头。
 */
import type { TwinNavigationMode } from '@dt/twin-config'
import * as THREE from 'three'

import type { SceneCore } from './sceneCore'

const MOVE_CODES = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ShiftLeft',
  'ShiftRight',
] as const
type MoveCode = (typeof MOVE_CODES)[number]

const LOOK_SENSITIVITY = 0.002
const LOOK_RESPONSE = 18
const MOVE_RESPONSE = 10
const MOVE_SPEED_RATIO = 0.22
const MIN_MOVE_SPEED = 0.5
const MIN_FOCUS_DISTANCE = 0.1
const MAX_PITCH = Math.PI / 2 - 0.02
const VELOCITY_EPSILON_SQ = 1e-6
const ANGLE_EPSILON = 1e-4

export interface GameNavigationOptions {
  core: SceneCore
  surface: HTMLElement
  /** 模型包围盒对角线；移动速度随场景体量变化。 */
  span: () => number
}

function isMoveCode(code: string): code is MoveCode {
  return MOVE_CODES.some((item) => item === code)
}

function responseFactor(response: number, deltaS: number): number {
  return 1 - Math.exp(-response * Math.max(0, deltaS))
}

function clampedPitch(value: number): number {
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, value))
}

/** 一套可在运行态与编辑态复用的游戏式相机控制。 */
export class GameNavigationControls {
  private readonly core: SceneCore
  private readonly surface: HTMLElement
  private readonly span: () => number
  private readonly pressed = new Set<MoveCode>()
  private readonly velocity = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()
  private readonly right = new THREE.Vector3()
  private readonly direction = new THREE.Vector3()
  private mode: TwinNavigationMode = 'orbit'
  private yaw = 0
  private pitch = 0
  private targetYaw = 0
  private targetPitch = 0
  private focusDistance = 1
  private orbitAutoRotate = false
  private lookDirty = false
  private interacting = false
  private attached = false
  private disposed = false

  constructor(options: GameNavigationOptions) {
    this.core = options.core
    this.surface = options.surface
    this.span = options.span
  }

  /** 切换操作模式；切回轨道时释放 Pointer Lock 并清空惯性。 */
  setMode(mode: TwinNavigationMode): void {
    if (this.disposed || mode === this.mode) return
    this.mode = mode
    this.core.controls.enabled = mode === 'orbit'
    this.surface.style.cursor = mode === 'game' ? 'crosshair' : ''
    if (mode === 'game') {
      this.attach()
      this.orbitAutoRotate = this.core.controls.autoRotate
      this.core.controls.autoRotate = false
      this.flushOrbitMomentum()
      this.syncFromCamera()
      return
    }
    this.core.controls.autoRotate = this.orbitAutoRotate
    this.clearMotion()
    if (document.pointerLockElement === this.surface) {
      document.exitPointerLock()
    }
    this.finishInteraction()
    this.detach()
  }

  /** 推进一帧阻尼；相机位姿有变化时返回 true。 */
  advance(deltaS: number): boolean {
    if (this.disposed || this.mode !== 'game') return false
    const looked = this.advanceLook(deltaS)
    const moved = this.advanceMove(deltaS)
    if (!this.isLocked() && !this.lookDirty && this.velocity.lengthSq() === 0) {
      this.finishInteraction()
    }
    return looked || moved
  }

  /** 释放全局监听、锁定与残余输入。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detach()
    this.clearMotion()
    if (document.pointerLockElement === this.surface) {
      document.exitPointerLock()
    }
    this.core.controls.enabled = true
    if (this.mode === 'game') {
      this.core.controls.autoRotate = this.orbitAutoRotate
    }
    this.surface.style.cursor = ''
    this.finishInteraction()
  }

  private attach(): void {
    if (this.attached) return
    this.attached = true
    this.surface.addEventListener('pointerdown', this.onPointerDown)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  private detach(): void {
    if (!this.attached) return
    this.attached = false
    this.surface.removeEventListener('pointerdown', this.onPointerDown)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  private syncFromCamera(): void {
    this.core.camera.getWorldDirection(this.direction)
    this.pitch = Math.asin(THREE.MathUtils.clamp(this.direction.y, -1, 1))
    this.yaw = Math.atan2(-this.direction.x, -this.direction.z)
    this.targetPitch = this.pitch
    this.targetYaw = this.yaw
    this.focusDistance = Math.max(
      MIN_FOCUS_DISTANCE,
      this.core.camera.position.distanceTo(this.core.controls.target),
    )
    this.lookDirty = false
  }

  /** 进入游戏档前吃掉轨道阻尼的尾巴，避免两套平滑在首帧抢镜头。 */
  private flushOrbitMomentum(): void {
    const damping = this.core.controls.enableDamping
    this.core.controls.enableDamping = false
    this.core.controls.update()
    this.core.controls.enableDamping = damping
  }

  private advanceLook(deltaS: number): boolean {
    if (!this.lookDirty) return false
    const factor = responseFactor(LOOK_RESPONSE, deltaS)
    this.yaw += (this.targetYaw - this.yaw) * factor
    this.pitch += (this.targetPitch - this.pitch) * factor
    if (
      Math.abs(this.targetYaw - this.yaw) < ANGLE_EPSILON &&
      Math.abs(this.targetPitch - this.pitch) < ANGLE_EPSILON
    ) {
      this.yaw = this.targetYaw
      this.pitch = this.targetPitch
      this.lookDirty = false
    }
    this.core.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
    this.syncTarget()
    return true
  }

  private advanceMove(deltaS: number): boolean {
    const desired = this.desiredVelocity()
    this.velocity.lerp(desired, responseFactor(MOVE_RESPONSE, deltaS))
    if (this.velocity.lengthSq() < VELOCITY_EPSILON_SQ)
      this.velocity.set(0, 0, 0)
    if (this.velocity.lengthSq() === 0 || deltaS <= 0) return false
    this.core.camera.position.addScaledVector(this.velocity, deltaS)
    this.syncTarget()
    return true
  }

  /** 把当前按键合成单位方向，再按场景体量换成目标速度。 */
  private desiredVelocity(): THREE.Vector3 {
    this.desired.set(0, 0, 0)
    this.core.camera.getWorldDirection(this.forward)
    this.forward.y = 0
    if (this.forward.lengthSq() > 0) this.forward.normalize()
    this.right.crossVectors(this.forward, this.core.camera.up).normalize()
    if (this.pressed.has('KeyW')) this.desired.add(this.forward)
    if (this.pressed.has('KeyS')) this.desired.sub(this.forward)
    if (this.pressed.has('KeyD')) this.desired.add(this.right)
    if (this.pressed.has('KeyA')) this.desired.sub(this.right)
    const vertical =
      Number(this.pressed.has('Space')) -
      Number(this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'))
    this.desired.addScaledVector(this.core.camera.up, vertical)
    if (this.desired.lengthSq() > 0) {
      const speed = Math.max(MIN_MOVE_SPEED, this.span() * MOVE_SPEED_RATIO)
      this.desired.normalize().multiplyScalar(speed)
    }
    return this.desired
  }

  private syncTarget(): void {
    this.core.camera.getWorldDirection(this.direction)
    this.core.controls.target
      .copy(this.core.camera.position)
      .addScaledVector(this.direction, this.focusDistance)
  }

  private beginInteraction(): void {
    if (this.interacting) return
    this.interacting = true
    this.core.controls.dispatchEvent({ type: 'start' })
  }

  private finishInteraction(): void {
    if (!this.interacting) return
    this.interacting = false
    this.core.controls.dispatchEvent({ type: 'end' })
  }

  private clearMotion(): void {
    this.pressed.clear()
    this.velocity.set(0, 0, 0)
    this.desired.set(0, 0, 0)
    this.lookDirty = false
  }

  private isLocked(): boolean {
    return document.pointerLockElement === this.surface
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.mode !== 'game' || event.button !== 0 || this.isLocked()) return
    if (typeof this.surface.requestPointerLock !== 'function') return
    this.syncFromCamera()
    const request = this.surface.requestPointerLock()
    if (request !== undefined) void request.catch(() => undefined)
  }

  private readonly onPointerLockChange = (): void => {
    if (this.isLocked()) {
      this.syncFromCamera()
      this.beginInteraction()
      return
    }
    this.pressed.clear()
    if (this.velocity.lengthSq() === 0) this.finishInteraction()
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.mode !== 'game' || !this.isLocked()) return
    this.targetYaw -= event.movementX * LOOK_SENSITIVITY
    this.targetPitch = clampedPitch(
      this.targetPitch - event.movementY * LOOK_SENSITIVITY,
    )
    this.lookDirty = true
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.mode !== 'game' || !this.isLocked() || !isMoveCode(event.code))
      return
    event.preventDefault()
    this.pressed.add(event.code)
    this.beginInteraction()
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!isMoveCode(event.code)) return
    this.pressed.delete(event.code)
  }

  private readonly onBlur = (): void => this.pressed.clear()

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.pressed.clear()
  }
}
