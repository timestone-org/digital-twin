"""模型配置分支的有界执行样本，覆盖每个可选算法参数值。"""

type ConfigCase = tuple[str, dict[str, object]]


def kernel_configs(code: str, algorithm: str) -> list[ConfigCase]:
    """核函数与适用的核宽度配置。Args: code, algorithm。"""
    fixed = "fixed" if code == "anomaly_model" else "value"
    return [
        (
            code,
            {"algorithm": algorithm, "kernel": kernel, "gamma_mode": gamma},
        )
        for kernel in ("rbf", "linear", "poly", "sigmoid")
        for gamma in (
            ("scale",) if kernel == "linear" else ("scale", "auto", fixed)
        )
    ]


def supervised_configs() -> list[ConfigCase]:
    """监督模型的核、神经网络、损失函数和近邻配置。"""
    cases: list[ConfigCase] = []
    for code, svm in (
        ("regression_model", "svr"),
        ("classification_model", "svc"),
    ):
        cases.extend(kernel_configs(code, svm))
        cases.extend(
            (code, {"algorithm": "mlp", "activation": activation})
            for activation in ("relu", "tanh", "logistic", "identity")
        )
        losses = (
            ("squared_error", "huber", "epsilon_insensitive")
            if code == "regression_model"
            else ("hinge", "log_loss", "modified_huber")
        )
        cases.extend(
            (code, {"algorithm": "sgd", "sgd_loss": loss}) for loss in losses
        )
        cases.extend(
            (code, {"algorithm": "knn", "neighbor_weights": weight})
            for weight in ("uniform", "distance")
        )
    return cases


def balancing_configs() -> list[ConfigCase]:
    """需要重建与回放的类别平衡和品牌采样配置。"""
    cases: list[ConfigCase] = [
        (
            "classification_model",
            {"algorithm": algorithm, "class_weight": "balanced"},
        )
        for algorithm in (
            "logistic",
            "sgd",
            "decision_tree",
            "random_forest",
            "extra_trees",
            "svc",
            "linear_svc",
            "lightgbm",
            "catboost",
        )
    ]
    cases.extend(
        (
            code,
            {
                "algorithm": algorithm,
                "row_subsample": 0.95,
                "feature_subsample": 0.97,
            },
        )
        for code in ("regression_model", "classification_model")
        for algorithm in ("xgboost", "lightgbm", "catboost")
    )
    return cases


def unsupervised_configs() -> list[ConfigCase]:
    """批量聚类与异常边界估计的算法分支。"""
    cases: list[ConfigCase] = [
        (
            "clustering_analysis",
            {"algorithm": "gaussian_mixture", "covariance_type": value},
        )
        for value in ("diag", "spherical", "tied", "full")
    ]
    cases.extend(
        (
            "clustering_analysis",
            {
                "algorithm": "agglomerative",
                "linkage": linkage,
                "metric": metric,
            },
        )
        for linkage in ("ward", "average", "complete", "single")
        for metric in (
            ("euclidean",)
            if linkage == "ward"
            else ("euclidean", "manhattan", "cosine")
        )
    )
    cases.extend(
        ("clustering_analysis", {"algorithm": "spectral", "affinity": value})
        for value in ("rbf", "nearest_neighbors")
    )
    cases.append(
        (
            "clustering_analysis",
            {
                "algorithm": "mean_shift",
                "bandwidth_mode": "fixed",
                "bandwidth": 0.5,
            },
        )
    )
    cases.extend(kernel_configs("anomaly_model", "one_class_svm"))
    cases.append(
        (
            "anomaly_model",
            {
                "algorithm": "elliptic_envelope",
                "support_fraction_mode": "fixed",
            },
        )
    )
    return cases


def algorithm_configs() -> list[ConfigCase]:
    """全部配置分支，以配置文本生成可定位的用例名。"""
    return [
        *supervised_configs(),
        *balancing_configs(),
        *unsupervised_configs(),
    ]
