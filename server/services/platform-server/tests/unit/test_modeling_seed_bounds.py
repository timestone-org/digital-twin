"""随机种子在保存期就封顶：超过 2**32-1 的种子到运行期才在 sklearn 里炸。"""

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import registry

_TOO_BIG = 2**32


@pytest.mark.parametrize(
    "code", ["tree_regressor", "split_samples", "feature_importance"]
)
def test_an_oversized_seed_is_refused_at_save_time(code: str) -> None:
    with pytest.raises(ValidationError):
        registry.build(code, {"random_state": _TOO_BIG})


@pytest.mark.parametrize(
    "code", ["tree_regressor", "split_samples", "feature_importance"]
)
def test_the_largest_seed_is_accepted(code: str) -> None:
    _, config = registry.build(code, {"random_state": _TOO_BIG - 1})
    assert getattr(config, "random_state") == _TOO_BIG - 1  # noqa: B009
