"""运行参数域的异常（错误码领域号 10，与大屏面同段）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含表名、SQL、内网地址等内部信息。
"""

from lib.errors import AppError


class RuntimeParamUnknown(AppError):
    """参数目录里没有这个分组或这一项。

    ⚠ 「分组不存在」与「键不存在」共用这一个码：对调用方来说处置完全相同
    ——照着 `GET /runtime-params` 回的目录重发一次。
    """

    code = 41020
    http_status = 400
