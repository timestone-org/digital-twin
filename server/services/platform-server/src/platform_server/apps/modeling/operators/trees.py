"""树模型：随机森林与梯度提升回归。**通道 B** 的第一批算子。

⚠ 它们的拟合参数是一堆对象，纯 JSON 表达不出来——所以 `fitted` 是空的，真东西
在**二进制产物**里（docs/MODELING_PLATFORM_DESIGN.md D9）。
⚠ 正因为 `fitted` 空着，发布那一侧「该带参数的一步空着就不许上线」那道闸必须
认得出通道 B——判据是 `SERVING_CHANNEL`，不是「fitted 有没有东西」。
⚠ 树模型对量纲**不敏感**，不必接标准化；但它也**不外推**——训练区间之外一律给
边界值，而那个数看着完全正常。模型签名上的训练区间因此对它格外重要。
"""

from typing import Any, Literal, cast

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_MODEL,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.estimators import TreeEnsemble
from platform_server.apps.modeling.operators.frame import (
    ROLE_FEATURE,
    Frame,
    frame_input,
    matrix_of,
    numbers_of,
)
from platform_server.apps.modeling.operators.model import (
    SCORED_PRED,
    SCORED_TRUE,
    TASK_REGRESSION,
    scored_frame,
    single_target,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.operators.registry import register_operator

# 树的棵数与深度的上下限。⚠ 必须封顶：一千棵树的产物有几百 MB，而它要跨进程
# 回传、进对象存储、再在每个 API 副本上反序列化一次
MAX_TREES = 500
MAX_DEPTH = 40

type TreeShape = Literal["forest", "gbdt"]


class TreeRegressorConfig(OperatorConfig):
    """树回归的参数。"""

    shape: TreeShape = Field(
        default="forest",
        title="哪一种",
        description=(
            "forest=随机森林，每棵树独立、抗过拟合；"
            "gbdt=梯度提升，逐棵纠正上一棵的残差、通常更准但更容易过拟合"
        ),
    )
    n_estimators: int = Field(
        default=100,
        ge=1,
        le=MAX_TREES,
        title="多少棵树",
        description="越多越稳、越慢，产物也越大",
    )
    max_depth: int = Field(
        default=0,
        ge=0,
        le=MAX_DEPTH,
        title="每棵树最深几层",
        description="0 表示不限（随机森林长到纯；梯度提升按它自己的默认）",
    )
    random_state: int = Field(
        default=42,
        ge=0,
        title="随机种子",
        description="定住它，同一份数据每次训出同一个模型",
    )


@register_operator
class TreeRegressor(OperatorBase):
    """树集成回归。拟合结果走二进制产物（通道 B）。"""

    CODE = "tree_regressor"
    NAME = "树回归"
    DESCRIPTION = "随机森林 / 梯度提升回归；对量纲不敏感，但不会外推"
    CATEGORY = "model"
    ICON = "network"
    CONFIG_MODEL = TreeRegressorConfig
    INPUTS = (
        PortSpec(name="train", contract=CONTRACT_FRAME, label="训练集"),
        PortSpec(name="test", contract=CONTRACT_FRAME, label="测试集"),
    )
    OUTPUTS = (
        PortSpec(name="model", contract=CONTRACT_MODEL, label="模型"),
        PortSpec(
            name="scored",
            contract=CONTRACT_FRAME,
            label="打分",
            description="测试集上的真实值与预测值，供评估算子算指标",
        ),
    )
    REQUIRES_FIT = True
    SERVING_CHANNEL = "binary"

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._trees: TreeEnsemble | None = None
        self._feature_keys: tuple[str, ...] = ()

    @property
    def _config(self) -> TreeRegressorConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, TreeRegressorConfig):  # pragma: no cover
            raise OperatorError("树回归拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """打分帧是新造的两列，与两个输入的列集无关。

        Args: config, inputs。
        """
        del config, inputs
        return {"scored": (SCORED_TRUE, SCORED_PRED)}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """在训练集上拟合，在测试集上打分。

        Args: inputs。
        """
        train = frame_input(inputs, "train")
        test = frame_input(inputs, "test")
        feature_keys = train.keys_by_role(ROLE_FEATURE)
        target_key = single_target(train)
        if not feature_keys:
            raise OperatorError("训练集里一个特征列都没有")
        self._fit(train, feature_keys, target_key)
        return {
            "model": ModelPayload(
                algo=self.CODE,
                task=TASK_REGRESSION,
                feature_keys=feature_keys,
                target_key=target_key,
                hyper_params=_hyper_params_of(self._config),
                # ⚠ 刻意是空的：真东西在二进制产物里
                fitted={},
                serving_channel=self.SERVING_CHANNEL,
            ),
            "scored": scored_frame(test, target_key, self.predict_rows(test)),
        }

    def predict_rows(self, frame: Frame) -> list[float]:
        """整批打分。

        ⚠ 与线性那几个一样，训练期给测试集打分与推理期预测走**这同一个方法**。
        Args: frame。
        """
        trees = self._trees
        if trees is None:
            raise OperatorError("模型还没有拟合结果")
        return trees.predict(matrix_of(frame, self._feature_keys))

    def trained_estimator(self) -> object | None:
        """交出估计器去封存。没训过就没有。"""
        return None if self._trees is None else self._trees.estimator

    def dump_fitted(self) -> dict[str, Any] | None:
        """通道 B 没有纯 JSON 的拟合参数，只留一份**列序**。

        ⚠ 列序必须存：产物自己不记列名，投影时按位置取——列序对不上时预测照样
        算得出来，只是每一列都错位了（§5.2）。
        """
        return {"feature_keys": list(self._feature_keys)}

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌列序。估计器本身由产物那条路加载。

        Args: params。
        """
        self.validate_fitted(params)
        raw = cast("list[object]", params["feature_keys"])
        self._feature_keys = tuple(str(item) for item in raw)

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """列序必须是一串不重样的列 key。

        Args: params。
        """
        raw: object = params.get("feature_keys")
        if not isinstance(raw, list) or not raw:
            raise OperatorError("树模型缺少特征列序")
        keys = [str(item) for item in cast("list[object]", raw)]
        if len(set(keys)) != len(keys):
            raise OperatorError("特征列序里有重复")

    def attach_estimator(self, estimator: object) -> None:
        """把从产物里加载回来的估计器装上。

        ⚠ 只接受 `TreeEnsemble` 认得的那个形状；对不上时说清楚而不是硬用。
        Args: estimator。
        """
        trees = TreeEnsemble(
            kind=self._config.shape,
            n_estimators=self._config.n_estimators,
            max_depth=self._config.max_depth or None,
            random_state=self._config.random_state,
        )
        trees.adopt(estimator, feature_count=len(self._feature_keys))
        self._trees = trees

    def _fit(
        self, train: Frame, feature_keys: tuple[str, ...], target_key: str
    ) -> None:
        config = self._config
        target = numbers_of(train, target_key)
        if any(value is None for value in target):
            raise OperatorError("训练集的目标列里有空值，请先补一个填缺失")
        trees = TreeEnsemble(
            kind=config.shape,
            n_estimators=config.n_estimators,
            max_depth=config.max_depth or None,
            random_state=config.random_state,
        )
        trees.fit(
            matrix_of(train, feature_keys),
            [float(value or 0.0) for value in target],
        )
        self._trees = trees
        self._feature_keys = feature_keys


def _hyper_params_of(config: TreeRegressorConfig) -> dict[str, Any]:
    """落进模型描述里的超参，界面上照它显示。

    ⚠ 必须是那个算子配置的**原样**：特征重要性那一步要靠它把模型重建出来。
    Args: config。
    """
    return {
        "shape": config.shape,
        "n_estimators": config.n_estimators,
        "max_depth": config.max_depth,
        "random_state": config.random_state,
    }
