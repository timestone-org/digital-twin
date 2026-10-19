"""层级图领域错误码。"""

from lib.errors import Conflict, NotFound


class ProjectMissing(NotFound):
    code: int = 42501


class RevisionConflict(Conflict):
    code: int = 42502
