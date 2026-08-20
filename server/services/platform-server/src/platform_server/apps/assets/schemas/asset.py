"""素材面的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

import uuid

from pydantic import Field

from platform_server.apps.assets.schemas.common import (
    AssetKind,
    AssetName,
    ContentType,
    InputModel,
    OutputModel,
    Utc,
)


class AssetOut(OutputModel):
    """一个素材。

    `ref` 是**唯一合法的落库形态**：大屏配置里存它而不是 URL——URL 会随部署
    地址与构建产物变，存进去下次就 404。取回地址由前端单点拼装。
    """

    id: uuid.UUID
    ref: str
    kind: str
    name: str
    content_type: str
    size_bytes: int
    checksum: str
    created_at: Utc
    created_by: str


class AssetKindOut(OutputModel):
    """一类素材的登记信息，给前端做文件选择器的 accept 与预检。

    ⚠ 上限随目录一起下发，不让界面自己写一份：两边各写一份时前端放行的文件
    会在上传那一刻被存储端拒掉，而用户看到的只是一个含糊的失败。
    """

    kind: str
    label: str
    content_types: list[str]
    max_bytes: int


class UploadTicketOut(OutputModel):
    """一次直传的表单凭证。

    ⚠ `fields` 必须原样按序写进 multipart 表单，且**文件字段排在最后**：
    S3 的 POST 语义是「文件之后的字段一律忽略」，把签名排到文件后面，
    存储端读到的就是一份缺字段的表单，报出来的是含糊的 403。
    """

    asset_id: uuid.UUID
    url: str
    fields: dict[str, str]
    expires_seconds: int


class PresignUploadIn(InputModel):
    """申请一次直传凭证。

    ⚠ `size_bytes` 是**声明**不是事实：真实大小由存储端按签进 policy 的区间
    强制，并在 finalize 时以存储端读到的为准落库。这里只用来提前拒掉明显超限
    的文件，省掉一次上传。
    ⚠ 刻意不收显示名：签凭证不落行，收了也无处可存；名字在 finalize 时才给。
    """

    kind: AssetKind
    content_type: ContentType
    size_bytes: int = Field(gt=0)


class FinalizeUploadIn(InputModel):
    """确认一次直传已完成。

    ⚠ 刻意只收显示名：类型从对象键里读回来，大小与校验和以存储端读到的为准。
    多收一样就多一个与真实字节对不上的机会，而对不上时没有任何一处会报错。
    """

    name: AssetName


class AssetUpdateIn(InputModel):
    """改一个素材的显示名。

    ⚠ 只收显示名：类型、大小与校验和都是**字节的事实**，由存储端读回来落库。
    放开它们等于允许库里的元信息与桶里的字节对不上，而对不上时没有任何一处
    会报错——界面上显示的体积与那个文件本身再无关系。
    """

    name: AssetName
