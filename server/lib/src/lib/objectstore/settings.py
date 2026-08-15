"""对象存储连接组。与其它连接组一样：密钥无默认值，缺失即拒绝启动。"""

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings


class ObjectStoreSettings(BaseSettings):
    """S3 兼容对象存储的连接组。"""

    # 服务端到存储的地址（容器网络内），例 http://minio:9000
    objectstore_endpoint: str
    # 浏览器侧到存储的地址前缀，由边缘反代到桶根。
    # ⚠ 与 endpoint 分开是必须的：直传凭证若带着容器内地址发给浏览器，
    # 浏览器解析不到 `minio` 这个名字，报的却是一句笼统的网络错误
    objectstore_public_base: str = "/oss/"
    objectstore_bucket: str = Field(min_length=3)
    # ⚠ 凭据无默认值：弱默认的对象存储凭据等于把直传签名的能力公开出去
    objectstore_access_key: SecretStr = Field(min_length=3)
    objectstore_secret_key: SecretStr = Field(min_length=8)
    # S3 协议必填但对自建实现无意义，给一个固定值即可
    objectstore_region: str = "us-east-1"
    # ⚠ 自建实现只支持 path-style（`/<bucket>/<key>`）：默认的 virtual-host
    # 风格会把桶名拼成子域名，本地与容器里都解析不到，报的却是连接超时
    objectstore_path_style_enabled: bool = True
    objectstore_connect_timeout_s: float = 3.0
    objectstore_read_timeout_s: float = 10.0
    # 单次操作的重试次数。写操作超时按不可重试处理，故这里只兜网络层瞬断
    objectstore_max_attempts: int = 2

    def objectstore_target(self) -> str:
        """可写进日志的连接目标：只有地址与桶名，没有凭据。

        ⚠ 名字带组前缀是刻意的：多个连接组会被同一个 Settings 多继承，
        同名方法会被 MRO 静默遮蔽掉一个。
        """
        return f"{self.objectstore_endpoint}/{self.objectstore_bucket}"
