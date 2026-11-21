"""代表用户去打 platform 时要转发的那几个签名头。

账号名、角色、权限和到期时间均按签发时的字节传递，由接收服务核验。
转换 UUID 或还原百分号编码都会改变签名输入。
"""

from collections.abc import Mapping

from lib.auth import IDENTITY_HEADERS

FORWARDED = IDENTITY_HEADERS


def caller_headers(given: Mapping[str, str]) -> dict[str, str]:
    """从入站请求头里挑出要转发的那几个，原样带走。

    ⚠ 缺失的头**不补空串**：补了的话下游收到一组「齐全但内容为空」的头，
    验签失败的原因会从「少了一个头」变成「签名不符」，而后者听起来像被篡改。

    Args: given。
    """
    headers = {name.lower(): value for name, value in given.items()}
    return {
        name: headers[name.lower()]
        for name in FORWARDED
        if headers.get(name.lower()) not in (None, "")
    }
