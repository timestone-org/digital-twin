"""服务器证书与私钥：只落挂载卷，库里只存指纹。

⚠ 私钥**绝不进数据库**（CONTEXT.md §2 不变式 7）：进库就会随数据库备份跑到
任何存备份的地方，而备份通常不按密钥的口径管理。本模块也绝不把私钥内容
返回给调用方或写进日志，对外只给路径、指纹、主体与有效期末。

文件读写与 RSA 生成都是阻塞调用，一律 `asyncio.to_thread` 挪出事件循环——
在 `async def` 里直接做会把整个进程的所有实例一起卡住（code-style §5.1）。
"""

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from lib.utils.timeutils import Clock, to_utc, utcnow

# OPC UA 的应用实例证书按规范要求 RSA ≥ 2048
KEY_SIZE_BITS = 2048
PUBLIC_EXPONENT = 65537
# 私钥文件只有属主可读写；目录同理
KEY_FILE_MODE = 0o600
PKI_DIR_MODE = 0o700


@dataclass(frozen=True)
class CertificateMaterial:
    """一套服务器证书。**不含私钥内容**，只有它在卷上的位置。"""

    certificate_path: Path
    private_key_path: Path
    fingerprint_sha256: str
    subject: str
    not_valid_after: datetime


class PkiStore:
    """按实例存取证书。目录来自 `OPCUA_PKI_DIR`，是部署期挂载卷。"""

    def __init__(
        self,
        directory: Path,
        *,
        valid_days: int,
        clock: Clock = utcnow,
    ) -> None:
        """按目录与有效期初始化。

        Args: directory, valid_days, clock（测试注入固定时钟）。
        """
        self._directory = directory
        self._valid_days = valid_days
        self._clock = clock

    def certificate_path(self, instance_id: UUID) -> Path:
        """该实例的证书路径（DER，asyncua 按扩展名识别）。

        Args: instance_id。
        """
        return self._directory / f"{instance_id}.der"

    def private_key_path(self, instance_id: UUID) -> Path:
        """该实例的私钥路径（PEM）。

        Args: instance_id。
        """
        return self._directory / f"{instance_id}.key.pem"

    async def ensure(
        self, instance_id: UUID, *, application_uri: str, hostname: str
    ) -> CertificateMaterial:
        """取该实例的证书；没有就自签一套。

        Args: instance_id, application_uri, hostname。
        """
        existing = await self.material(instance_id)
        if existing is not None:
            return existing
        return await asyncio.to_thread(
            self._generate, instance_id, application_uri, hostname
        )

    async def material(self, instance_id: UUID) -> CertificateMaterial | None:
        """读已有证书的元信息；不存在则 None。

        Args: instance_id。
        """
        return await asyncio.to_thread(self._read, instance_id)

    def _read(self, instance_id: UUID) -> CertificateMaterial | None:
        """同步读盘，由 `material` 挪到线程里调。

        Args: instance_id。
        """
        certificate_path = self.certificate_path(instance_id)
        private_key_path = self.private_key_path(instance_id)
        if not certificate_path.is_file() or not private_key_path.is_file():
            return None
        certificate = x509.load_der_x509_certificate(
            certificate_path.read_bytes()
        )
        return self._describe(certificate, instance_id)

    def _describe(
        self, certificate: x509.Certificate, instance_id: UUID
    ) -> CertificateMaterial:
        """把证书压成对外的元信息。

        Args: certificate, instance_id。
        """
        return CertificateMaterial(
            certificate_path=self.certificate_path(instance_id),
            private_key_path=self.private_key_path(instance_id),
            fingerprint_sha256=fingerprint_of(
                certificate.public_bytes(serialization.Encoding.DER)
            ),
            subject=certificate.subject.rfc4514_string(),
            not_valid_after=to_utc(certificate.not_valid_after_utc),
        )

    def _generate(
        self, instance_id: UUID, application_uri: str, hostname: str
    ) -> CertificateMaterial:
        """自签一套并落盘。同步实现，由 `ensure` 挪到线程里调。

        RSA 生成是 CPU 密集的，但 OpenSSL 在生成期间释放 GIL，且每个实例
        一生只做一次，因此线程足够，不必动进程池。

        Args: instance_id, application_uri, hostname。
        """
        self._directory.mkdir(parents=True, exist_ok=True, mode=PKI_DIR_MODE)
        key = rsa.generate_private_key(
            public_exponent=PUBLIC_EXPONENT, key_size=KEY_SIZE_BITS
        )
        certificate = self._sign(key, instance_id, application_uri, hostname)
        self._write(instance_id, key, certificate)
        return self._describe(certificate, instance_id)

    def _sign(
        self,
        key: rsa.RSAPrivateKey,
        instance_id: UUID,
        application_uri: str,
        hostname: str,
    ) -> x509.Certificate:
        """签一张应用实例证书。

        ⚠ SAN 里必须带 `application_uri`：OPC UA 客户端会拿它与端点声明的
        ApplicationUri 比对，不一致的证书会被拒绝，而报错信息通常只说
        「证书不受信任」，与真实原因隔得很远。

        Args: key, instance_id, application_uri, hostname。
        """
        subject = x509.Name(
            [
                x509.NameAttribute(NameOID.COMMON_NAME, f"opcua-{instance_id}"),
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "DigitalTwin"),
            ]
        )
        issued_at = to_utc(self._clock())
        return (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(subject)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(issued_at - timedelta(days=1))
            .not_valid_after(issued_at + timedelta(days=self._valid_days))
            .add_extension(
                x509.BasicConstraints(ca=False, path_length=None), critical=True
            )
            .add_extension(_key_usage(), critical=True)
            .add_extension(_extended_key_usage(), critical=False)
            .add_extension(
                _subject_alt_names(application_uri, hostname), critical=False
            )
            .sign(key, hashes.SHA256())
        )

    def _write(
        self,
        instance_id: UUID,
        key: rsa.RSAPrivateKey,
        certificate: x509.Certificate,
    ) -> None:
        """落盘。私钥文件权限收到 0600。

        Args: instance_id, key, certificate。
        """
        certificate_path = self.certificate_path(instance_id)
        private_key_path = self.private_key_path(instance_id)
        certificate_path.write_bytes(
            certificate.public_bytes(serialization.Encoding.DER)
        )
        private_key_path.write_bytes(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
        private_key_path.chmod(KEY_FILE_MODE)


def _key_usage() -> x509.KeyUsage:
    """OPC UA 应用实例证书要求的 keyUsage 组合。"""
    return x509.KeyUsage(
        digital_signature=True,
        content_commitment=True,
        key_encipherment=True,
        data_encipherment=True,
        key_agreement=False,
        key_cert_sign=False,
        crl_sign=False,
        encipher_only=False,
        decipher_only=False,
    )


def _extended_key_usage() -> x509.ExtendedKeyUsage:
    """服务端与客户端认证都要有——反向连接场景下服务器也当客户端。"""
    return x509.ExtendedKeyUsage(
        [ExtendedKeyUsageOID.SERVER_AUTH, ExtendedKeyUsageOID.CLIENT_AUTH]
    )


def _subject_alt_names(
    application_uri: str, hostname: str
) -> x509.SubjectAlternativeName:
    """SAN：URI 供 OPC UA 比对，DNS 供常规 TLS 校验。

    Args: application_uri, hostname。
    """
    return x509.SubjectAlternativeName(
        [
            x509.UniformResourceIdentifier(application_uri),
            x509.DNSName(hostname),
        ]
    )


def fingerprint_of(der: bytes) -> str:
    """DER 证书的 SHA-256 指纹，小写十六进制。

    客户端信任列表按它比对——公钥不是秘密，指纹可以进库。

    Args: der。
    """
    return hashlib.sha256(der).hexdigest()
