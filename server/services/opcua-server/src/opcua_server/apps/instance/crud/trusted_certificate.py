"""客户端信任证书的数据访问。"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from opcua_server.apps.instance.models import TrustedCertificate


class TrustedCertificateCrud(CrudBase[TrustedCertificate]):
    """`opcua_instance_trusted_certs` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(TrustedCertificate)

    async def get_by_fingerprint(
        self, session: AsyncSession, *, instance_id: uuid.UUID, fingerprint: str
    ) -> TrustedCertificate | None:
        """按实例内的指纹取证书。指纹就是这张证书的身份。

        Args: session, instance_id, fingerprint。
        """
        result = await session.execute(
            select(TrustedCertificate).where(
                TrustedCertificate.instance_id == instance_id,
                TrustedCertificate.fingerprint == fingerprint,
            )
        )
        return result.scalars().one_or_none()

    async def list_of_instance(
        self, session: AsyncSession, instance_id: uuid.UUID
    ) -> list[TrustedCertificate]:
        """取某实例的全部信任证书，供启动时装配白名单。

        Args: session, instance_id。
        """
        result = await session.execute(
            select(TrustedCertificate)
            .where(TrustedCertificate.instance_id == instance_id)
            .order_by(TrustedCertificate.subject.asc())
        )
        return list(result.scalars().all())


trusted_certificate_crud = TrustedCertificateCrud()
