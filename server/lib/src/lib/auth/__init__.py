"""认证的纯算法件。读用户表的依赖注入件留在属主服务，不放这里。"""

from lib.auth.context import CallerContext
from lib.auth.header_codec import (
    MAX_PERMISSION_HEADER_BYTES,
    decode_identity,
    decode_permissions,
    encode_identity,
    encode_permissions,
    sign_context,
    verify_context,
)
from lib.auth.jwt import JwtCodec, TokenClaims, TokenError
from lib.auth.password import PasswordHasher

__all__ = [
    "MAX_PERMISSION_HEADER_BYTES",
    "CallerContext",
    "JwtCodec",
    "PasswordHasher",
    "TokenClaims",
    "TokenError",
    "decode_identity",
    "decode_permissions",
    "encode_identity",
    "encode_permissions",
    "sign_context",
    "verify_context",
]
