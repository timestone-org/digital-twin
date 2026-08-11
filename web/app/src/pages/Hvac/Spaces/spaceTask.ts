/**
 * @fileoverview 「起个名字」这件事的四种形态：建/改车间、建/改房间。
 * 收成一个判别联合，页面就只需要一个弹窗与一个提交入口，而不是四套。
 */

import type { Room, Workshop } from '@dt/contracts'

import * as hvac from '@/api/hvac'

export type SpaceTask =
  | { kind: 'workshop-create' }
  | { kind: 'workshop-rename'; workshop: Workshop }
  | { kind: 'room-create'; workshopId: string }
  | { kind: 'room-rename'; room: Room }

interface TaskCopy {
  title: string
  description: string
  initial: string
  done: string
}

/** 弹窗的标题、说明、初值与成功提示。 */
export function copyOf(task: SpaceTask): TaskCopy {
  if (task.kind === 'workshop-create') {
    return {
      title: '新建车间',
      description: '车间名全场唯一',
      initial: '',
      done: '车间已创建',
    }
  }
  if (task.kind === 'workshop-rename') {
    return {
      title: '重命名车间',
      description: '车间名全场唯一',
      initial: task.workshop.name,
      done: '车间已更新',
    }
  }
  if (task.kind === 'room-create') {
    return {
      title: '新建房间',
      description: '房间名只在本车间内唯一，别的车间可以有同名房间',
      initial: '',
      done: '房间已创建',
    }
  }
  return {
    title: '重命名房间',
    description: '房间名只在本车间内唯一',
    initial: task.room.name,
    done: '房间已更新',
  }
}

/** 按形态调对应的接口。调用方负责 try/catch 与刷新。 */
export async function submitTask(task: SpaceTask, name: string): Promise<void> {
  if (task.kind === 'workshop-create') {
    await hvac.createWorkshop(name)
    return
  }
  if (task.kind === 'workshop-rename') {
    await hvac.updateWorkshop(task.workshop.id, name)
    return
  }
  if (task.kind === 'room-create') {
    await hvac.createRoom({ workshop_id: task.workshopId, name })
    return
  }
  await hvac.updateRoom(task.room.id, { name })
}
