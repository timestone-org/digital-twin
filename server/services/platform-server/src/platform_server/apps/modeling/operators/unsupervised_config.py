"""批量聚类与正常工况异常模型的有界配置。"""

from typing import Literal

from pydantic import Field, JsonValue

from platform_server.apps.modeling.operators.base import (
    OperatorConfig,
    column_field,
)

type ClusterAlgorithm = Literal[
    "kmeans",
    "minibatch_kmeans",
    "gaussian_mixture",
    "dbscan",
    "agglomerative",
    "birch",
    "mean_shift",
    "spectral",
]
type AnomalyAlgorithm = Literal[
    "isolation_forest",
    "local_outlier_factor",
    "one_class_svm",
    "elliptic_envelope",
]


def visible(*algorithms: str) -> dict[str, JsonValue]:
    return {"x-dt-visible-when": {"algorithm": list(algorithms)}}


class ClusteringConfig(OperatorConfig):
    """对当前批次聚类，不声明可部署模型。"""

    algorithm: ClusterAlgorithm = Field(
        default="kmeans",
        title="聚类算法",
        description="kmeans=K均值；minibatch_kmeans=小批量K均值；gaussian_mixture=高斯混合；dbscan=密度聚类；agglomerative=层次聚类；birch=BIRCH聚类；mean_shift=均值漂移；spectral=谱聚类",
    )
    columns: list[str] = column_field(
        title="参与聚类的数值列",
        description="留空选择全部数值特征列；目标列不参与，缺失与非有限值需先处理",
        default_factory=list[str],
    )
    output_column: str = Field(
        default="cluster_id",
        min_length=1,
        max_length=128,
        title="聚类标签列",
        description="追加字符串标签；-1表示密度聚类噪声，原始数据保持不变",
    )
    should_standardize: bool = Field(
        default=True,
        title="按本批次标准化",
        description="在内部按各列均值与标准差统一量纲，不修改输出的原始列",
    )
    random_state: int = Field(default=42, ge=0, le=2147483647, title="随机种子")
    silhouette_rows: int = Field(
        default=500,
        ge=20,
        le=2000,
        title="轮廓系数最多抽样行数",
        description="排除噪声后固定种子抽样；少于两簇或无定义时留空，不以零代替",
    )
    n_clusters: int = Field(
        default=3,
        ge=1,
        le=64,
        title="目标簇数",
        json_schema_extra=visible(
            "kmeans",
            "minibatch_kmeans",
            "gaussian_mixture",
            "agglomerative",
            "birch",
            "spectral",
        ),
    )
    max_iter: int = Field(
        default=100,
        ge=10,
        le=500,
        title="最多迭代次数",
        json_schema_extra=visible(
            "kmeans", "minibatch_kmeans", "gaussian_mixture", "mean_shift"
        ),
    )
    batch_size: int = Field(
        default=256,
        ge=16,
        le=4096,
        title="每批样本数",
        json_schema_extra=visible("minibatch_kmeans"),
    )
    covariance_type: Literal["diag", "spherical", "tied", "full"] = Field(
        default="diag",
        title="协方差形状",
        description="diag=各特征独立方差；spherical=每簇单一方差；tied=各簇共享完整矩阵；full=每簇完整矩阵",
        json_schema_extra=visible("gaussian_mixture"),
    )
    reg_covar: float = Field(
        default=1e-6,
        ge=1e-9,
        le=1,
        title="协方差正则项",
        json_schema_extra=visible("gaussian_mixture"),
    )
    eps: float = Field(
        default=0.5,
        gt=0,
        le=1e6,
        title="邻域半径",
        description="使用标准化时为标准化空间中的距离，请结合聚类结果调整",
        json_schema_extra=visible("dbscan"),
    )
    min_samples: int = Field(
        default=5,
        ge=2,
        le=1000,
        title="核心点最少邻居数",
        description="包含样本自身",
        json_schema_extra=visible("dbscan"),
    )
    linkage: Literal["ward", "average", "complete", "single"] = Field(
        default="ward",
        title="簇间合并方式",
        description="ward=最小化簇内方差；average=平均距离；complete=最大距离；single=最小距离",
        json_schema_extra=visible("agglomerative"),
    )
    metric: Literal["euclidean", "manhattan", "cosine"] = Field(
        default="euclidean",
        title="层次聚类距离",
        description="euclidean=欧氏距离；manhattan=曼哈顿距离；cosine=余弦距离",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["agglomerative"],
                "linkage": ["average", "complete", "single"],
            }
        },
    )
    birch_threshold: float = Field(
        default=0.5,
        gt=0,
        le=1e6,
        title="子簇半径阈值",
        json_schema_extra=visible("birch"),
    )
    branching_factor: int = Field(
        default=50,
        ge=10,
        le=200,
        title="树节点分支数",
        json_schema_extra=visible("birch"),
    )
    bandwidth_mode: Literal["auto", "fixed"] = Field(
        default="auto",
        title="带宽设置",
        description="auto=固定种子抽样估计；fixed=指定带宽",
        json_schema_extra=visible("mean_shift"),
    )
    bandwidth: float = Field(
        default=1,
        gt=0,
        le=1e6,
        title="固定带宽",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["mean_shift"],
                "bandwidth_mode": ["fixed"],
            }
        },
    )
    bandwidth_quantile: float = Field(
        default=0.3,
        gt=0,
        le=1,
        title="带宽距离分位数",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["mean_shift"],
                "bandwidth_mode": ["auto"],
            }
        },
    )
    affinity: Literal["rbf", "nearest_neighbors"] = Field(
        default="rbf",
        title="相似度构造",
        description="rbf=径向核；nearest_neighbors=近邻图",
        json_schema_extra=visible("spectral"),
    )
    n_neighbors: int = Field(
        default=10,
        ge=2,
        le=100,
        title="谱聚类邻居数",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["spectral"],
                "affinity": ["nearest_neighbors"],
            }
        },
    )
    gamma: float = Field(
        default=1,
        ge=0.001,
        le=1000,
        title="径向核系数",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["spectral"],
                "affinity": ["rbf"],
            }
        },
    )


class AnomalyModelConfig(OperatorConfig):
    """正常训练样本内部留出校准的异常模型配置。"""

    algorithm: AnomalyAlgorithm = Field(
        default="isolation_forest",
        title="异常检测算法",
        description="isolation_forest=孤立森林；local_outlier_factor=局部离群因子；one_class_svm=单类SVM；elliptic_envelope=椭圆包络",
    )
    quantile: float = Field(
        default=0.99,
        ge=0.9,
        le=0.9999,
        title="正常样本校准分位数",
        description="越高越宽松；只用训练内部留出段校准，不使用测试段，不代表故障概率",
    )
    calibration_ratio: float = Field(
        default=0.25,
        ge=0.15,
        le=0.4,
        title="训练内部校准段比例",
        description="训练帧前段拟合，后段校准；独立测试帧仅用于评价",
    )
    scale_floor: float = Field(
        default=0.01,
        ge=1e-9,
        le=1e6,
        title="标准化最小尺度",
        description="拟合段标准差的下限，避免常量特征除零；缺失输入仍拒绝",
    )
    random_state: int = Field(default=42, ge=0, le=2147483647, title="随机种子")
    n_estimators: int = Field(
        default=100,
        ge=10,
        le=500,
        title="孤立树数量",
        json_schema_extra=visible("isolation_forest"),
    )
    max_samples: int = Field(
        default=256,
        ge=16,
        le=10000,
        title="每棵树最多样本数",
        description="实际样本数不足时使用全部拟合段",
        json_schema_extra=visible("isolation_forest"),
    )
    n_neighbors: int = Field(
        default=20,
        ge=2,
        le=200,
        title="局部邻居数",
        description="必须小于实际拟合段行数；固定使用novelty模式支持新样本",
        json_schema_extra=visible("local_outlier_factor"),
    )
    kernel: Literal["rbf", "linear", "poly", "sigmoid"] = Field(
        default="rbf",
        title="单类SVM核函数",
        description="rbf=径向核；linear=线性核；poly=多项式核；sigmoid=双曲正切核",
        json_schema_extra=visible("one_class_svm"),
    )
    gamma_mode: Literal["scale", "auto", "fixed"] = Field(
        default="scale",
        title="核系数设置",
        description="scale=依据拟合数据方差；auto=特征数倒数；fixed=指定数值",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["one_class_svm"],
                "kernel": ["rbf", "poly", "sigmoid"],
            }
        },
    )
    gamma: float = Field(
        default=0.1,
        gt=0,
        le=1000,
        title="固定核系数",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["one_class_svm"],
                "kernel": ["rbf", "poly", "sigmoid"],
                "gamma_mode": ["fixed"],
            }
        },
    )
    nu: float = Field(
        default=0.05,
        gt=0,
        le=0.5,
        title="单类SVM边界参数",
        description="控制支持向量与拟合容忍度；最终异常判定仍由独立校准阈值决定",
        json_schema_extra=visible("one_class_svm"),
    )
    max_iter: int = Field(
        default=1000,
        ge=100,
        le=10000,
        title="SVM最多迭代次数",
        json_schema_extra=visible("one_class_svm"),
    )
    support_fraction_mode: Literal["auto", "fixed"] = Field(
        default="auto",
        title="稳健协方差样本比例",
        description="auto=算法自动选择；fixed=指定拟合比例",
        json_schema_extra=visible("elliptic_envelope"),
    )
    support_fraction: float = Field(
        default=0.8,
        gt=0.5,
        le=1,
        title="固定稳健拟合比例",
        json_schema_extra={
            "x-dt-visible-when": {
                "algorithm": ["elliptic_envelope"],
                "support_fraction_mode": ["fixed"],
            }
        },
    )
