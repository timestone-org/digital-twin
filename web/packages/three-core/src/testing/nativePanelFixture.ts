/** @fileoverview 原生卡片的可测尺寸夹具。 */
import { PanelSurface } from '../panelSurface'

export function nativeSurface(): { surface: PanelSurface; card: HTMLElement } {
  const mount = document.createElement('div')
  const card = document.createElement('div')
  card.style.transform = 'matrix(1, 0, 0, 1, -100, -50)'
  card.style.transformOrigin = '0px 0px'
  Object.defineProperties(card, {
    offsetWidth: { get: () => 200, configurable: true },
    offsetHeight: { get: () => 100, configurable: true },
  })
  mount.append(card)
  document.body.append(mount)
  const surface = new PanelSurface(mount)
  surface.scale.setScalar(0.005)
  return { surface, card }
}
