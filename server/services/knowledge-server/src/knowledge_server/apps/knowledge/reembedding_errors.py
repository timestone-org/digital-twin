"""整库重嵌管理面的拒绝原因。"""

from lib.errors import Conflict, DependencyUnavailable, NotFound


class PreviewChanged(Conflict):
    code = 42330


class ReembeddingInProgress(Conflict):
    code = 42331


class CorpusUnavailable(Conflict):
    code = 42332


class ReembeddingNotFound(NotFound):
    code = 42333


class ReembeddingKeyConflict(Conflict):
    code = 42334


class ReceiptUnconfirmed(DependencyUnavailable):
    code = 52335
    is_outcome_unknown = True
    is_retryable = False
