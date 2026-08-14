"""运行参数的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

from pydantic import Field

from platform_server.apps.runtime_params.catalog import Number, ParamKind
from platform_server.apps.runtime_params.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)


class RuntimeParamOut(OutputModel):
    """一项运行参数的登记信息与当前状态。

    `value` 是**有效值**：有覆盖行就是覆盖值，没有就是环境变量给的默认值。
    `env_name` 给运维对着 .env 看——界面上改的和文件里写的是同一件事。

    ⚠ `minimum` / `maximum` 随取值一起下发，不让界面自己写一份：两边各写一份
    时前端放行的值会被服务端 422 挡回来，而用户看不出自己错在哪。
    """

    section: str
    key: str
    env_name: str
    write_code: str
    label: str
    hint: str
    kind: ParamKind
    unit: str
    step: Number
    minimum: Number
    maximum: Number
    value: Number
    default_value: Number
    previous_value: Number | None
    is_overridden: bool
    updated_at: Utc | None
    updated_by: str | None


class RuntimeParamWriteIn(InputModel):
    """改一个分组里的若干项。没给的项不动。

    ⚠ 值等于默认值时**删掉覆盖行**而不是存一行等值的：表里只存被改过的项，
    存等值行会让这一项从此不再跟随环境变量，而界面上看不出任何区别。
    """

    values: dict[str, Number] = Field(min_length=1)
