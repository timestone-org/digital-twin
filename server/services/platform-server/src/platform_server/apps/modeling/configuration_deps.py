"""模板配置写入的权限、幂等与审计身份。"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from platform_server.apps.modeling.deps import (
    WriteGate,
    get_instance_write_context,
    get_manage_context,
    get_publish_context,
)
from platform_server.apps.modeling.services.pipeline_service import Actor


@dataclass(frozen=True)
class ConfigurationWriteContext:
    gate: WriteGate
    actor: Actor


def _context(request: Request, gate: WriteGate) -> ConfigurationWriteContext:
    return ConfigurationWriteContext(
        gate=gate,
        actor=Actor(
            user_id=str(gate.caller.user_id),
            name=gate.caller.username,
            source_ip=request.client.host if request.client else None,
        ),
    )


def get_template_write(
    request: Request, gate: Annotated[WriteGate, Depends(get_manage_context)]
) -> ConfigurationWriteContext:
    return _context(request, gate)


def get_instance_write(
    request: Request,
    gate: Annotated[WriteGate, Depends(get_instance_write_context)],
) -> ConfigurationWriteContext:
    return _context(request, gate)


def get_instance_publish(
    request: Request, gate: Annotated[WriteGate, Depends(get_publish_context)]
) -> ConfigurationWriteContext:
    return _context(request, gate)
