"""OPC UA 服务端域的异常（错误码领域号 21）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含端口号以外的内部信息——不写文件路径、不写库表名。
"""

from lib.errors import AppError


class InstanceNotFound(AppError):
    """实例不存在，或存在但调用者无权看见。"""

    code = 42101
    http_status = 404


class InstanceNameTaken(AppError):
    """同名实例已存在。名称是人给的标识，必须唯一才能在页面上指认。"""

    code = 42102
    http_status = 409


class PortPoolExhausted(AppError):
    """端口池已用尽。

    ⚠ 这里必须响亮失败，不许挑一个池外端口顶上：池外端口没有容器映射，
    上位机连不上，而实例状态会显示「运行中」——最难排查的一类故障。
    """

    code = 42103
    http_status = 409


class InstanceAlreadyRunning(AppError):
    """实例已在运行，重复启动无意义。"""

    code = 42104
    http_status = 409


class InstanceNotRunning(AppError):
    """实例未运行，该操作要求它在跑。"""

    code = 42105
    http_status = 409


class NodeNotFound(AppError):
    """节点不存在于该实例。"""

    code = 42106
    http_status = 404


class NodeIdentifierTaken(AppError):
    """标识在实例内已被占用。

    ⚠ 标识由人指定且**永不自动改写**——上位系统的组态硬编码着 NodeId，
    我们这边换一个，现场所有组态一起废。冲突只能报错，不能自动改名。
    """

    code = 42107
    http_status = 409


class NodeValueRejected(AppError):
    """写入的值与节点数据类型不符，或超出该类型的取值范围。"""

    code = 42108
    http_status = 400


class NodeNotWritable(AppError):
    """节点的访问级别不允许写入。"""

    code = 42109
    http_status = 409


class InstanceLimitReached(AppError):
    """已达单进程实例数上限。"""

    code = 42110
    http_status = 409


class CredentialNotFound(AppError):
    """实例凭据不存在。"""

    code = 42111
    http_status = 404


class TrustedCertificateInvalid(AppError):
    """客户端证书无法解析，或指纹与已登记的不符。"""

    code = 42112
    http_status = 400


class InstanceStartFailed(AppError):
    """实例启动失败（端口被占、证书不可读、地址空间构建失败）。"""

    code = 52101
    http_status = 500


class NodeDeleteFailed(AppError):
    """从运行中的地址空间删除节点失败。

    ⚠ asyncua 的 `delete_nodes` 删不掉时**不抛异常**，失败写在返回的状态码里。
    不查状态码就会静默半成功：管理面报「已删除」，上位机却还读得到。
    """

    code = 52102
    http_status = 500
