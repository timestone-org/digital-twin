"""认证模块的业务层，也是本模块对外的公开面。

事务边界在这一层：crud 不提交，api 不写业务。
"""

from auth_server.apps.auth.services.auth_service import AuthService
from auth_server.apps.auth.services.identity import (
    Identity,
    Operation,
    load_identity,
    load_identity_by_id,
)
from auth_server.apps.auth.services.matching import (
    Decision,
    DecisionReason,
    RuleView,
    decide,
    find_rule,
    is_redundant,
    normalize_path,
    sort_key,
)
from auth_server.apps.auth.services.route_rule_service import (
    RouteRuleCache,
)
from auth_server.apps.auth.services.token_service import (
    TokenPair,
    TokenService,
)
from auth_server.apps.auth.services.verify_service import VerifyService

__all__ = [
    "AuthService",
    "Decision",
    "DecisionReason",
    "Identity",
    "Operation",
    "RouteRuleCache",
    "RuleView",
    "TokenPair",
    "TokenService",
    "VerifyService",
    "decide",
    "find_rule",
    "is_redundant",
    "load_identity",
    "load_identity_by_id",
    "normalize_path",
    "sort_key",
]
