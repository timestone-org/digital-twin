"""通用监督模型的有界参数与按算法显示的配置。"""

from typing import Annotated, Literal

from pydantic import Field, JsonValue

from platform_server.apps.modeling.operators.base import OperatorConfig

type RegressionAlgorithm = Literal[
    "ridge",
    "lasso",
    "elastic_net",
    "bayesian_ridge",
    "huber",
    "sgd",
    "decision_tree",
    "random_forest",
    "extra_trees",
    "gradient_boosting",
    "hist_gradient_boosting",
    "adaboost",
    "knn",
    "svr",
    "mlp",
    "xgboost",
    "lightgbm",
    "catboost",
]
type ClassificationAlgorithm = Literal[
    "logistic",
    "sgd",
    "decision_tree",
    "random_forest",
    "extra_trees",
    "gradient_boosting",
    "hist_gradient_boosting",
    "adaboost",
    "knn",
    "svc",
    "linear_svc",
    "gaussian_nb",
    "bernoulli_nb",
    "lda",
    "qda",
    "mlp",
    "xgboost",
    "lightgbm",
    "catboost",
]

SCALED_ALGORITHMS = (
    "ridge",
    "lasso",
    "elastic_net",
    "bayesian_ridge",
    "huber",
    "sgd",
    "knn",
    "svr",
    "svc",
    "linear_svc",
    "logistic",
    "mlp",
    "lda",
    "qda",
)
DEFAULT_HIDDEN_LAYERS = (64, 32)
ITERATIVE_ALGORITHMS = (
    "lasso",
    "elastic_net",
    "bayesian_ridge",
    "huber",
    "sgd",
    "logistic",
    "linear_svc",
    "svr",
    "svc",
    "mlp",
)
TREE_ALGORITHMS = (
    "decision_tree",
    "random_forest",
    "extra_trees",
    "gradient_boosting",
    "hist_gradient_boosting",
    "adaboost",
)
BRAND_TREE_ALGORITHMS = ("xgboost", "lightgbm")
ENSEMBLE_ALGORITHMS = (
    "random_forest",
    "extra_trees",
    "gradient_boosting",
    "adaboost",
)
RANDOM_ALGORITHMS = (
    "sgd",
    "decision_tree",
    "random_forest",
    "extra_trees",
    "gradient_boosting",
    "hist_gradient_boosting",
    "adaboost",
    "mlp",
)
REGRESSION_LABELS = {
    "ridge": "岭回归",
    "lasso": "Lasso回归",
    "elastic_net": "弹性网络回归",
    "bayesian_ridge": "贝叶斯岭回归",
    "huber": "Huber稳健回归",
    "sgd": "随机梯度线性回归",
    "decision_tree": "决策树回归",
    "random_forest": "随机森林回归",
    "extra_trees": "极端随机树回归",
    "gradient_boosting": "梯度提升回归",
    "hist_gradient_boosting": "直方图梯度提升回归",
    "adaboost": "AdaBoost回归",
    "knn": "近邻回归",
    "svr": "支持向量回归",
    "mlp": "多层感知机回归",
    "xgboost": "XGBoost回归",
    "lightgbm": "LightGBM回归",
    "catboost": "CatBoost回归",
}
CLASSIFICATION_LABELS = {
    "logistic": "多分类逻辑回归",
    "sgd": "随机梯度分类",
    "decision_tree": "决策树分类",
    "random_forest": "随机森林分类",
    "extra_trees": "极端随机树分类",
    "gradient_boosting": "梯度提升分类",
    "hist_gradient_boosting": "直方图梯度提升分类",
    "adaboost": "AdaBoost分类",
    "knn": "近邻分类",
    "svc": "核支持向量分类",
    "linear_svc": "线性支持向量分类",
    "gaussian_nb": "高斯朴素贝叶斯",
    "bernoulli_nb": "伯努利朴素贝叶斯",
    "lda": "线性判别分析",
    "qda": "二次判别分析",
    "mlp": "多层感知机分类",
    "xgboost": "XGBoost分类",
    "lightgbm": "LightGBM分类",
    "catboost": "CatBoost分类",
}


def shown(*algorithms: str) -> dict[str, JsonValue]:
    """声明参数适用的算法。Args: algorithms。"""
    return {"x-dt-visible-when": {"algorithm": list(algorithms)}}


class SupervisedConfig[AlgorithmT: str](OperatorConfig):
    """两族共用参数，隐藏字段保留原值但不改变其他算法。"""

    algorithm: AlgorithmT = Field(title="模型算法")
    should_standardize: bool = Field(
        default=True,
        title="模型内自动标准化",
        description="仅在训练集拟合均值和尺度，冻结后同样用于测试与预测",
        json_schema_extra=shown(*SCALED_ALGORITHMS),
    )
    use_intercept: bool = Field(
        default=True,
        title="拟合截距",
        json_schema_extra=shown(
            "ridge",
            "lasso",
            "elastic_net",
            "bayesian_ridge",
            "huber",
            "sgd",
            "logistic",
            "linear_svc",
        ),
    )
    alpha: float = Field(
        default=0.1,
        gt=0,
        le=1_000_000,
        title="正则化强度 α",
        description="越大越强；随机梯度模型通常从 0.0001 附近试起",
        json_schema_extra=shown(
            "ridge",
            "lasso",
            "elastic_net",
            "huber",
            "sgd",
            "mlp",
            "bernoulli_nb",
        ),
    )
    l1_ratio: float = Field(
        default=0.5,
        ge=0,
        le=1,
        title="L1 正则占比",
        json_schema_extra={**shown("elastic_net"), "x-dt-step": 0.05},
    )
    max_iter: int = Field(
        default=300,
        ge=1,
        le=2000,
        title="最大迭代次数",
        description="达到上限会明确提示未收敛；核支持向量最多训练 5000 行",
        json_schema_extra=shown(*ITERATIVE_ALGORITHMS),
    )
    tolerance: float = Field(
        default=0.0001,
        gt=0,
        le=1,
        title="收敛容差",
        description="越小要求越严格，训练可能更慢",
        json_schema_extra=shown(*ITERATIVE_ALGORITHMS),
    )
    random_state: int = Field(
        default=42,
        ge=0,
        le=2**32 - 1,
        title="随机种子",
        description="固定后，相同输入与参数使用相同随机序列",
        json_schema_extra=shown(
            *RANDOM_ALGORITHMS, "xgboost", "lightgbm", "catboost"
        ),
    )
    n_estimators: int = Field(
        default=100,
        ge=1,
        le=300,
        title="基学习器数量",
        description="更多通常更稳定，也会增加训练时间与模型体积",
        json_schema_extra=shown(
            *ENSEMBLE_ALGORITHMS, "xgboost", "lightgbm", "catboost"
        ),
    )
    max_depth: int = Field(
        default=8,
        ge=1,
        le=30,
        title="单棵树最大深度",
        json_schema_extra=shown(*TREE_ALGORITHMS, *BRAND_TREE_ALGORITHMS),
    )
    max_leaf_nodes: int = Field(
        default=64,
        ge=2,
        le=1024,
        title="单棵树最大叶子数",
        description="同时限制模型体积，防止过细分割",
        json_schema_extra=shown(*TREE_ALGORITHMS, *BRAND_TREE_ALGORITHMS),
    )
    min_samples_leaf: int = Field(
        default=2,
        ge=1,
        le=10_000,
        title="每片叶子最少样本",
        json_schema_extra=shown(*TREE_ALGORITHMS, "lightgbm"),
    )
    learning_rate: float = Field(
        default=0.1,
        gt=0,
        le=1,
        title="提升学习率",
        description="越小通常需要更多基学习器",
        json_schema_extra={
            **shown(
                "gradient_boosting",
                "hist_gradient_boosting",
                "adaboost",
                "xgboost",
                "lightgbm",
                "catboost",
            ),
            "x-dt-step": 0.01,
        },
    )
    boosting_iterations: int = Field(
        default=100,
        ge=1,
        le=1000,
        title="直方图提升轮数",
        json_schema_extra=shown("hist_gradient_boosting"),
    )
    n_neighbors: int = Field(
        default=5,
        ge=1,
        le=100,
        title="近邻数量",
        description="不能超过训练样本数",
        json_schema_extra=shown("knn"),
    )
    neighbor_weights: Literal["uniform", "distance"] = Field(
        default="distance",
        title="近邻权重",
        description="uniform=每个近邻权重相同；distance=越近权重越高",
        json_schema_extra=shown("knn"),
    )
    c_value: float = Field(
        default=1.0,
        gt=0,
        le=1_000_000,
        title="惩罚强度 C",
        description="越大越重视拟合训练数据",
        json_schema_extra=shown("logistic", "svr", "svc", "linear_svc"),
    )
    kernel: Literal["rbf", "linear", "poly", "sigmoid"] = Field(
        default="rbf",
        title="核函数",
        description="rbf=径向基核；linear=线性核；poly=多项式核；sigmoid=双曲正切核",
        json_schema_extra=shown("svr", "svc"),
    )
    gamma_mode: Literal["scale", "auto", "value"] = Field(
        default="scale",
        title="核宽度设置",
        description="scale=按特征方差自动确定；auto=特征数的倒数；value=指定数值",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["svr", "svc"],
                "kernel": ["rbf", "poly", "sigmoid"],
            }
        },
    )
    gamma_value: float = Field(
        default=0.1,
        gt=0,
        le=1_000_000,
        title="核宽度 γ",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["svr", "svc"],
                "kernel": ["rbf", "poly", "sigmoid"],
                "gamma_mode": ["value"],
            }
        },
    )
    degree: int = Field(
        default=3,
        ge=1,
        le=5,
        title="多项式次数",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["svr", "svc"],
                "kernel": ["poly"],
            }
        },
    )
    hidden_layers: list[Annotated[int, Field(ge=1, le=256)]] = Field(
        default_factory=lambda: list(DEFAULT_HIDDEN_LAYERS),
        min_length=1,
        max_length=3,
        title="隐藏层神经元数量",
        description="按顺序填写每层宽度，最多三层、每层最多 256 个",
        json_schema_extra={
            **shown("mlp"),
            "default": list(DEFAULT_HIDDEN_LAYERS),
        },
    )
    activation: Literal["relu", "tanh", "logistic", "identity"] = Field(
        default="relu",
        title="隐藏层激活函数",
        description="relu=线性整流；tanh=双曲正切；logistic=逻辑函数；identity=恒等函数",
        json_schema_extra=shown("mlp"),
    )
    initial_learning_rate: float = Field(
        default=0.001,
        gt=0,
        le=1,
        title="初始学习率",
        json_schema_extra=shown("mlp"),
    )
    boost_l1: float = Field(
        default=0.0,
        ge=0,
        le=1_000_000,
        title="提升树 L1 正则",
        json_schema_extra=shown("xgboost", "lightgbm"),
    )
    boost_l2: float = Field(
        default=1.0,
        ge=0,
        le=1_000_000,
        title="提升树 L2 正则",
        json_schema_extra=shown("xgboost", "lightgbm", "catboost"),
    )
    row_subsample: float = Field(
        default=1.0,
        gt=0,
        le=1,
        title="每轮样本采样比例",
        description="1 表示使用全部训练样本",
        json_schema_extra={
            **shown("xgboost", "lightgbm", "catboost"),
            "x-dt-step": 0.05,
        },
    )
    feature_subsample: float = Field(
        default=1.0,
        gt=0,
        le=1,
        title="特征采样比例",
        description="每轮或每层使用的特征比例，口径由品牌算法决定",
        json_schema_extra={
            **shown("xgboost", "lightgbm", "catboost"),
            "x-dt-step": 0.05,
        },
    )
    min_split_gain: float = Field(
        default=0.0,
        ge=0,
        le=1_000_000,
        title="分裂所需最小增益",
        json_schema_extra=shown("xgboost", "lightgbm"),
    )
    min_child_weight: float = Field(
        default=1.0,
        ge=0,
        le=1_000_000,
        title="子节点最小二阶权重",
        description="XGBoost 的最小 Hessian 权重，不是样本行数",
        json_schema_extra=shown("xgboost"),
    )
    catboost_depth: int = Field(
        default=6,
        ge=1,
        le=10,
        title="对称树深度",
        description="最多 10 层，即每棵树最多 1024 片叶子",
        json_schema_extra=shown("catboost"),
    )


class RegressionModelConfig(SupervisedConfig[RegressionAlgorithm]):
    """十八种回归模型的选择与专属参数。"""

    algorithm: RegressionAlgorithm = Field(
        default="ridge",
        title="回归算法",
        description="；".join(
            f"{key}={value}" for key, value in REGRESSION_LABELS.items()
        ),
    )
    huber_epsilon: float = Field(
        default=1.35,
        ge=1,
        le=10,
        title="Huber稳健阈值",
        description="越小越容易把偏离样本视为离群",
        json_schema_extra=shown("huber"),
    )
    sgd_loss: Literal["squared_error", "huber", "epsilon_insensitive"] = Field(
        default="squared_error",
        title="随机梯度损失",
        description="squared_error=平方误差；huber=稳健Huber；epsilon_insensitive=容忍区间外绝对误差",
        json_schema_extra=shown("sgd"),
    )
    epsilon: float = Field(
        default=0.1,
        gt=0,
        le=1_000_000,
        title="误差容忍宽度 ε",
        json_schema_extra=shown("svr"),
    )
    sgd_epsilon: float = Field(
        default=0.1,
        gt=0,
        le=1_000_000,
        title="随机梯度稳健阈值 ε",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["sgd"],
                "sgd_loss": ["huber", "epsilon_insensitive"],
            }
        },
    )


class ClassificationModelConfig(SupervisedConfig[ClassificationAlgorithm]):
    """十九种分类模型，保持原始数值类别映射。"""

    algorithm: ClassificationAlgorithm = Field(
        default="logistic",
        title="分类算法",
        description="；".join(
            f"{key}={value}" for key, value in CLASSIFICATION_LABELS.items()
        ),
    )
    class_weight: Literal["none", "balanced"] = Field(
        default="none",
        title="类别权重",
        description="none=每个样本权重相同；balanced=按类别频率反比平衡",
        json_schema_extra=shown(
            "logistic",
            "sgd",
            "decision_tree",
            "random_forest",
            "extra_trees",
            "svc",
            "linear_svc",
            "lightgbm",
            "catboost",
        ),
    )
    sgd_loss: Literal["hinge", "log_loss", "modified_huber"] = Field(
        default="log_loss",
        title="随机梯度损失",
        description="hinge=线性支持向量损失，不提供概率；log_loss=逻辑损失，提供概率；modified_huber=稳健分类损失，提供概率",
        json_schema_extra=shown("sgd"),
    )
    variance_smoothing: float = Field(
        default=1e-9,
        gt=0,
        le=1,
        title="高斯方差平滑",
        description="防止类内方差为零",
        json_schema_extra=shown("gaussian_nb"),
    )
    binarize_threshold: float = Field(
        default=0.0,
        title="伯努利二值化阈值",
        description="特征大于阈值记为 1，其余记为 0",
        json_schema_extra=shown("bernoulli_nb"),
    )
    covariance_regularization: float = Field(
        default=0.1,
        ge=0,
        le=1,
        title="二次判别协方差正则",
        description="增加可缓和小样本或共线性问题",
        json_schema_extra={**shown("qda"), "x-dt-step": 0.05},
    )
