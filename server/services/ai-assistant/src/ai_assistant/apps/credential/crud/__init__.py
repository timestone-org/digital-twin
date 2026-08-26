"""数据访问。只读写，不提交——事务边界归 service 层。"""

from ai_assistant.apps.credential.crud.credential import (
    CredentialCrud,
    credential_crud,
)

__all__ = ["CredentialCrud", "credential_crud"]
