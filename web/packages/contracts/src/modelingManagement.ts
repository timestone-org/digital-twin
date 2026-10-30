/** @fileoverview 从 platform OpenAPI 生成的建模命令契约。 */
import type { FieldError } from './envelope'
import type { ModelingJsonValue } from './modelingDetection'
export const MODELING_COMMAND_OPERATIONS = [
  'create_instance',
  'configure_instance',
  'train_instance',
  'publish_version',
  'deploy_instance',
  'create_deployment',
  'update_deployment',
  'archive_instance',
  'restore_instance',
  'archive_version',
  'restore_version',
  'switch_deployment',
  'rollback_deployment',
  'update_version',
  'retire_version',
  'delete_deployment',
  'cancel_run',
] as const
export type ModelingCommandOperation =
  (typeof MODELING_COMMAND_OPERATIONS)[number]

export const MODELING_COMMAND_STATES = [
  'pending',
  'unknown',
  'succeeded',
  'failed',
] as const
export type ModelingCommandState = (typeof MODELING_COMMAND_STATES)[number]

export type ModelingCommandFailure = {
  code: number
  details: FieldError[]
  message: string
}

export type ModelingCommand = {
  completed_at: string | null
  created_at: string
  error: ModelingCommandFailure | null
  http_status: number | null
  id: string
  is_verification_required: boolean
  operation:
    | 'create_instance'
    | 'configure_instance'
    | 'train_instance'
    | 'publish_version'
    | 'deploy_instance'
    | 'create_deployment'
    | 'update_deployment'
    | 'archive_instance'
    | 'restore_instance'
    | 'archive_version'
    | 'restore_version'
    | 'switch_deployment'
    | 'rollback_deployment'
    | 'update_version'
    | 'retire_version'
    | 'delete_deployment'
    | 'cancel_run'
  resource_id: string | null
  result: Record<string, ModelingJsonValue> | null
  state: 'pending' | 'unknown' | 'succeeded' | 'failed'
  trace_id: string
}
