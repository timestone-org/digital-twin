"""锁住 `opcua` schema 的结构契约：表名、列口径、约束名与枚举取值。

这一层不连库——它守的是「模型声明本身」，而模型声明是迁移的唯一真源。
约束名一旦漂移，将来的迁移就引用不到它；PG 的标识符上限 63 字符，超了
会被静默截断成带哈希的名字，不同环境还可能不同。
"""

from sqlalchemy import CheckConstraint, DateTime, Table, UniqueConstraint
from sqlalchemy.schema import DefaultClause

from opcua_server.apps.instance.models import (
    DATA_TYPES,
    DESIRED_STATES,
    IDENTIFIER_KINDS,
    NODE_CLASSES,
    SECURITY_POLICIES,
    TYPE_KINDS,
    Base,
)

INSTANCES = "opcua.opcua_instances"
NODES = "opcua.opcua_nodes"
TYPES = "opcua.opcua_types"
CREDENTIALS = "opcua.opcua_instance_credentials"
TRUSTED_CERTS = "opcua.opcua_instance_trusted_certs"

EXPECTED_TABLES = {INSTANCES, NODES, TYPES, CREDENTIALS, TRUSTED_CERTS}
# PostgreSQL 的标识符上限
IDENTIFIER_LIMIT = 63


def _table(name: str) -> Table:
    return Base.metadata.tables[name]


def _constraint_names(name: str) -> set[str]:
    return {
        str(item.name)
        for item in _table(name).constraints
        if item.name is not None
    }


def _server_default(table_name: str, column_name: str) -> str:
    default = _table(table_name).columns[column_name].server_default
    assert isinstance(default, DefaultClause)
    return str(default.arg)


def _unique_columns(name: str) -> set[tuple[str, ...]]:
    return {
        tuple(column.name for column in item.columns)
        for item in _table(name).constraints
        if isinstance(item, UniqueConstraint)
    }


def test_schema_holds_exactly_the_five_owned_tables() -> None:
    """本服务独占 opcua schema，且只有这五张表。"""
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_every_table_lives_in_the_opcua_schema() -> None:
    """跨 schema 写入是越界；表必须全部落在自己的 schema 里。"""
    schemas = {table.schema for table in Base.metadata.tables.values()}
    assert schemas == {"opcua"}


def test_all_identifiers_fit_postgres_limit() -> None:
    """约束与索引名不得超过 63 字符，否则被截断成带哈希的名字。"""
    names = [
        str(item.name)
        for table in Base.metadata.tables.values()
        for item in [*table.constraints, *table.indexes]
        if item.name is not None
    ]
    too_long = [name for name in names if len(name) > IDENTIFIER_LIMIT]
    assert too_long == []


def test_every_timestamp_column_carries_a_timezone() -> None:
    """时刻一律 timestamptz——落库即失去口径，事后无法修复。"""
    naive = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, DateTime) and not column.type.timezone
    ]
    assert naive == []


def test_instance_port_and_name_are_unique() -> None:
    """端口是实例之间唯一的硬隔离，名称是人指认它的方式，两者都必须唯一。"""
    unique = _unique_columns(INSTANCES)
    assert ("name",) in unique
    assert ("port",) in unique


def test_instance_carries_an_explicit_pending_restart_flag() -> None:
    """待重启生效是实例上的显式字段，不让前端猜（CONTEXT §6）。"""
    column = _table(INSTANCES).columns["has_pending_restart"]
    assert column.nullable is False


def test_instance_defaults_to_stopped_and_no_anonymous() -> None:
    """新建的实例既不自动跑，也不放匿名进来。"""
    assert "'stopped'" in _server_default(INSTANCES, "desired_state")
    assert "false" in _server_default(INSTANCES, "is_anonymous_allowed")


def test_node_identifier_is_unique_within_its_instance() -> None:
    """标识在实例内唯一——上位机的组态按它寻址，重复即寻址歧义。"""
    assert ("instance_id", "identifier") in _unique_columns(NODES)


def test_node_does_not_store_a_namespace_index() -> None:
    """命名空间索引由系统钉死为 2，不入库也不暴露给用户填（不变式 4）。"""
    assert "namespace_index" not in _table(NODES).columns


def test_node_stores_an_initial_value_but_no_current_value() -> None:
    """当前值的权威源是进程内存，不落库；库里只有配置意义上的初值。"""
    columns = set(_table(NODES).columns.keys())
    assert "initial_value" in columns
    assert {"current_value", "value", "last_value"} & columns == set()


def test_numeric_identifier_is_constrained_to_digits() -> None:
    """数字标识必须真是数字，否则要到实例启动时才在 asyncua 侧炸。"""
    names = _constraint_names(NODES)
    assert "ck_opcua_nodes_numeric_identifier_is_digits" in names


def test_node_cannot_be_its_own_parent() -> None:
    """自引用成环会让建树递归不终止。"""
    assert "ck_opcua_nodes_no_self_parent" in _constraint_names(NODES)


def test_trusted_certificate_rejects_pasted_private_keys() -> None:
    """私钥绝不进库（不变式 7）；这条挡住最常见的粘贴形态。"""
    checks = [
        str(item.sqltext)
        for item in _table(TRUSTED_CERTS).constraints
        if isinstance(item, CheckConstraint)
    ]
    assert any("PRIVATE KEY" in text for text in checks)


def test_credential_stores_only_a_hash() -> None:
    """明文只在创建时返回一次，库里从来只有散列。"""
    columns = set(_table(CREDENTIALS).columns.keys())
    assert "hashed_password" in columns
    assert {"password", "plain_password", "secret"} & columns == set()


def test_credential_username_is_unique_within_its_instance() -> None:
    """同一实例里用户名唯一，跨实例可以重名——账号池按实例隔离。"""
    assert ("instance_id", "username") in _unique_columns(CREDENTIALS)


def test_type_definition_shares_the_identifier_rules_with_nodes() -> None:
    """类型与节点同一套标识口径，避免两处各写一份而漂移。"""
    names = _constraint_names(TYPES)
    assert "ck_opcua_types_numeric_identifier_is_digits" in names


def test_enumerations_are_plain_strings_not_native_enums() -> None:
    """枚举用 text + CHECK：原生 ENUM 改序会静默改变已存数据的含义。"""
    enumerated = (
        (INSTANCES, "desired_state"),
        (NODES, "node_class"),
        (NODES, "identifier_kind"),
        (TYPES, "kind"),
    )
    for table_name, column_name in enumerated:
        column = _table(table_name).columns[column_name]
        assert column.type.python_type is str


def test_enumeration_values_are_snake_case_literals() -> None:
    """字符串字面量枚举，不用数字——改顺序不该改变语义。"""
    for value in (
        *DESIRED_STATES,
        *NODE_CLASSES,
        *IDENTIFIER_KINDS,
        *DATA_TYPES,
        *TYPE_KINDS,
    ):
        assert value == value.lower()
        assert not value.isdigit()


def test_security_policies_match_asyncua_member_names() -> None:
    """策略名与 asyncua 的枚举成员名逐字一致，运行时才能直接映射。"""
    assert "NoSecurity" in SECURITY_POLICIES
    assert "Basic256Sha256_SignAndEncrypt" in SECURITY_POLICIES
    assert len(set(SECURITY_POLICIES)) == len(SECURITY_POLICIES)


def test_every_foreign_key_column_is_indexed() -> None:
    """PG 不给外键自动建索引，缺它会让父表删除全表扫子表。"""
    missing: list[str] = []
    for table in Base.metadata.tables.values():
        indexed = {
            tuple(column.name for column in index.columns)
            for index in table.indexes
        }
        missing.extend(
            f"{table.name}.{key.parent.name}"
            for key in table.foreign_keys
            if (key.parent.name,) not in indexed
        )
    assert missing == []
