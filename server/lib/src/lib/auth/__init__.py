"""认证的纯算法件。读用户表的依赖注入件留在属主服务，不放这里。"""

from lib.auth.context import CallerContext
from lib.auth.edge_headers import (
    HEADER_EXPIRES,
    HEADER_PERMISSIONS,
    HEADER_ROLE,
    HEADER_SIGNATURE,
    HEADER_TRUNCATED,
    HEADER_USER_ID,
    HEADER_USERNAME,
    REASON_BAD_EXPIRY,
    REASON_BAD_SIGNATURE,
    REASON_BAD_SUBJECT,
    REASON_MISSING,
    REASON_TRUNCATED,
    IdentityOutcome,
    decode_caller,
)
from lib.auth.header_codec import (
    MAX_PERMISSION_HEADER_BYTES,
    SignedContext,
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
    "HEADER_EXPIRES",
    "HEADER_PERMISSIONS",
    "HEADER_ROLE",
    "HEADER_SIGNATURE",
    "HEADER_TRUNCATED",
    "HEADER_USERNAME",
    "HEADER_USER_ID",
    "MAX_PERMISSION_HEADER_BYTES",
    "REASON_BAD_EXPIRY",
    "REASON_BAD_SIGNATURE",
    "REASON_BAD_SUBJECT",
    "REASON_MISSING",
    "REASON_TRUNCATED",
    "CallerContext",
    "IdentityOutcome",
    "JwtCodec",
    "PasswordHasher",
    "SignedContext",
    "TokenClaims",
    "TokenError",
    "decode_caller",
    "decode_identity",
    "decode_permissions",
    "encode_identity",
    "encode_permissions",
    "sign_context",
    "verify_context",
]
