/** @fileoverview 漫游每段进度覆盖飞行、停留、完成及空轨迹。 */
import {
  RoamTimeline,
  buildRoamSegments,
  normalizeTwinConfig,
} from '../src/index'
import { expect, it } from 'vitest'
it('进度按飞行加停留计算，最终保持100%', () => {
  const config = normalizeTwinConfig({
    cameras: [
      { id: 'a', position: [1, 0, 0] },
      { id: 'b', position: [0, 1, 0] },
    ],
    roamTour: { items: ['a', 'b'], segmentMs: 100, pauseMs: 100, loop: false },
  })
  const timeline = new RoamTimeline(
    buildRoamSegments(config.cameras, config.roamTour),
    false,
  )
  expect(timeline.segmentProgress).toBe(0)
  timeline.play()
  timeline.advance(50)
  expect(timeline.segmentProgress).toBe(25)
  timeline.advance(100)
  expect(timeline.segmentProgress).toBe(75)
  timeline.advance(50)
  expect(timeline.segmentProgress).toBe(100)
  expect(timeline.isPlaying).toBe(false)
  expect(new RoamTimeline([], false).segmentProgress).toBe(0)
})
