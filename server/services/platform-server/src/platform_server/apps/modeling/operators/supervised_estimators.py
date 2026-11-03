"""监督模型的 sklearn 构造边界；只返回原生可封存估计器。"""

from collections.abc import Callable
from typing import Any, TypedDict, cast

from sklearn.discriminant_analysis import (
    LinearDiscriminantAnalysis,
    QuadraticDiscriminantAnalysis,
)
from sklearn.ensemble import (
    AdaBoostClassifier,
    AdaBoostRegressor,
    ExtraTreesClassifier,
    ExtraTreesRegressor,
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import (
    BayesianRidge,
    ElasticNet,
    HuberRegressor,
    Lasso,
    LogisticRegression,
    Ridge,
    SGDClassifier,
    SGDRegressor,
)
from sklearn.naive_bayes import BernoulliNB, GaussianNB
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC, SVR, LinearSVC
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

from platform_server.apps.modeling.operators.external_boosting import (
    create_boosting,
)
from platform_server.apps.modeling.operators.supervised_config import (
    SCALED_ALGORITHMS,
    ClassificationModelConfig,
    RegressionModelConfig,
)


class _TreeOptions(TypedDict):
    max_depth: int
    max_leaf_nodes: int
    min_samples_leaf: int
    random_state: int


def _tree_options(
    config: RegressionModelConfig | ClassificationModelConfig,
) -> _TreeOptions:
    return {
        "max_depth": config.max_depth,
        "max_leaf_nodes": config.max_leaf_nodes,
        "min_samples_leaf": config.min_samples_leaf,
        "random_state": config.random_state,
    }


def regression_estimator(config: RegressionModelConfig) -> object:
    """构造回归估计器及显式选择的内置标准化。Args: config。"""
    if config.algorithm in {"xgboost", "lightgbm", "catboost"}:
        return create_boosting(
            config.algorithm, config, is_classification=False
        )
    builders = {
        **_regression_linear(config),
        **_regression_trees(config),
        **_regression_other(config),
    }
    return _scaled(builders[config.algorithm](), config)


def classification_estimator(config: ClassificationModelConfig) -> object:
    """构造分类估计器，不将决策分数当作概率。Args: config。"""
    if config.algorithm in {"xgboost", "lightgbm", "catboost"}:
        return create_boosting(config.algorithm, config, is_classification=True)
    builders = {
        **_classification_linear(config),
        **_classification_trees(config),
        **_classification_other(config),
    }
    return _scaled(builders[config.algorithm](), config)


def _scaled(
    estimator: object, config: RegressionModelConfig | ClassificationModelConfig
) -> object:
    if config.should_standardize and config.algorithm in SCALED_ALGORITHMS:
        return Pipeline([("scale", StandardScaler()), ("model", estimator)])
    return estimator


def _gamma(
    config: RegressionModelConfig | ClassificationModelConfig,
) -> Any:
    return (
        config.gamma_value
        if config.gamma_mode == "value"
        else config.gamma_mode
    )


def _regression_linear(
    config: RegressionModelConfig,
) -> dict[str, Callable[[], object]]:
    return {
        "ridge": lambda: Ridge(
            alpha=config.alpha,
            fit_intercept=config.use_intercept,
            max_iter=config.max_iter,
            tol=config.tolerance,
        ),
        "lasso": lambda: Lasso(
            alpha=config.alpha,
            fit_intercept=config.use_intercept,
            max_iter=config.max_iter,
            tol=config.tolerance,
        ),
        "elastic_net": lambda: ElasticNet(
            alpha=config.alpha,
            l1_ratio=config.l1_ratio,
            fit_intercept=config.use_intercept,
            max_iter=config.max_iter,
            tol=config.tolerance,
        ),
        "bayesian_ridge": lambda: BayesianRidge(
            fit_intercept=config.use_intercept,
            max_iter=config.max_iter,
            tol=config.tolerance,
        ),
        "huber": lambda: HuberRegressor(
            alpha=config.alpha,
            epsilon=config.huber_epsilon,
            fit_intercept=config.use_intercept,
            max_iter=config.max_iter,
            tol=config.tolerance,
        ),
        "sgd": lambda: SGDRegressor(
            loss=config.sgd_loss,
            alpha=config.alpha,
            fit_intercept=config.use_intercept,
            max_iter=config.max_iter,
            tol=config.tolerance,
            epsilon=config.sgd_epsilon,
            random_state=config.random_state,
        ),
    }


def _regression_trees(
    config: RegressionModelConfig,
) -> dict[str, Callable[[], object]]:
    tree = _tree_options(config)
    return {
        "decision_tree": lambda: DecisionTreeRegressor(**tree),
        "random_forest": lambda: RandomForestRegressor(
            n_estimators=config.n_estimators, n_jobs=1, **tree
        ),
        "extra_trees": lambda: ExtraTreesRegressor(
            n_estimators=config.n_estimators, n_jobs=1, **tree
        ),
        "gradient_boosting": lambda: GradientBoostingRegressor(
            n_estimators=config.n_estimators,
            learning_rate=config.learning_rate,
            **tree,
        ),
        "hist_gradient_boosting": lambda: HistGradientBoostingRegressor(
            max_iter=config.boosting_iterations,
            learning_rate=config.learning_rate,
            early_stopping=cast("Any", False),
            **tree,
        ),
        "adaboost": lambda: AdaBoostRegressor(
            estimator=DecisionTreeRegressor(**tree),
            n_estimators=config.n_estimators,
            learning_rate=config.learning_rate,
            random_state=config.random_state,
        ),
    }


def _regression_other(
    config: RegressionModelConfig,
) -> dict[str, Callable[[], object]]:
    return {
        "knn": lambda: KNeighborsRegressor(
            n_neighbors=config.n_neighbors,
            weights=config.neighbor_weights,
            n_jobs=1,
        ),
        "svr": lambda: SVR(
            C=config.c_value,
            epsilon=config.epsilon,
            kernel=config.kernel,
            gamma=_gamma(config),
            degree=config.degree,
            max_iter=config.max_iter,
            tol=config.tolerance,
            cache_size=128,
        ),
        "mlp": lambda: MLPRegressor(
            hidden_layer_sizes=tuple(config.hidden_layers),
            activation=config.activation,
            alpha=config.alpha,
            learning_rate_init=config.initial_learning_rate,
            max_iter=config.max_iter,
            tol=config.tolerance,
            random_state=config.random_state,
            early_stopping=cast("Any", False),
        ),
    }


def _classification_linear(
    config: ClassificationModelConfig,
) -> dict[str, Callable[[], object]]:
    weight = None if config.class_weight == "none" else "balanced"
    return {
        "logistic": lambda: LogisticRegression(
            C=config.c_value,
            fit_intercept=config.use_intercept,
            max_iter=config.max_iter,
            tol=config.tolerance,
            class_weight=weight,
        ),
        "sgd": lambda: SGDClassifier(
            loss=config.sgd_loss,
            alpha=config.alpha,
            fit_intercept=config.use_intercept,
            max_iter=config.max_iter,
            tol=config.tolerance,
            random_state=config.random_state,
            class_weight=weight,
            n_jobs=1,
        ),
        "svc": lambda: SVC(
            C=config.c_value,
            kernel=config.kernel,
            gamma=_gamma(config),
            degree=config.degree,
            max_iter=config.max_iter,
            tol=config.tolerance,
            class_weight=weight,
            cache_size=128,
        ),
        "linear_svc": lambda: LinearSVC(
            C=config.c_value,
            fit_intercept=config.use_intercept,
            max_iter=config.max_iter,
            tol=config.tolerance,
            class_weight=weight,
            random_state=config.random_state,
        ),
    }


def _classification_trees(
    config: ClassificationModelConfig,
) -> dict[str, Callable[[], object]]:
    tree = _tree_options(config)
    weight = None if config.class_weight == "none" else "balanced"
    return {
        "decision_tree": lambda: DecisionTreeClassifier(
            class_weight=weight, **tree
        ),
        "random_forest": lambda: RandomForestClassifier(
            n_estimators=config.n_estimators,
            n_jobs=1,
            class_weight=weight,
            **tree,
        ),
        "extra_trees": lambda: ExtraTreesClassifier(
            n_estimators=config.n_estimators,
            n_jobs=1,
            class_weight=weight,
            **tree,
        ),
        "gradient_boosting": lambda: GradientBoostingClassifier(
            n_estimators=config.n_estimators,
            learning_rate=config.learning_rate,
            **tree,
        ),
        "hist_gradient_boosting": lambda: HistGradientBoostingClassifier(
            max_iter=config.boosting_iterations,
            learning_rate=config.learning_rate,
            early_stopping=cast("Any", False),
            **tree,
        ),
        "adaboost": lambda: AdaBoostClassifier(
            estimator=DecisionTreeClassifier(**tree),
            n_estimators=config.n_estimators,
            learning_rate=config.learning_rate,
            random_state=config.random_state,
        ),
    }


def _classification_other(
    config: ClassificationModelConfig,
) -> dict[str, Callable[[], object]]:
    return {
        "knn": lambda: KNeighborsClassifier(
            n_neighbors=config.n_neighbors,
            weights=config.neighbor_weights,
            n_jobs=1,
        ),
        "gaussian_nb": lambda: GaussianNB(
            var_smoothing=config.variance_smoothing
        ),
        "bernoulli_nb": lambda: BernoulliNB(
            alpha=config.alpha, binarize=config.binarize_threshold
        ),
        "lda": LinearDiscriminantAnalysis,
        "qda": lambda: QuadraticDiscriminantAnalysis(
            reg_param=config.covariance_regularization
        ),
        "mlp": lambda: MLPClassifier(
            hidden_layer_sizes=tuple(config.hidden_layers),
            activation=config.activation,
            alpha=config.alpha,
            learning_rate_init=config.initial_learning_rate,
            max_iter=config.max_iter,
            tol=config.tolerance,
            random_state=config.random_state,
            early_stopping=cast("Any", False),
        ),
    }
