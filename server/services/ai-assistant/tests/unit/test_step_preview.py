"""步骤预览的钳制与摊平。

守的是「界面上看得见、而且看得完」：值太长要截断且说出来，嵌套结构要摊成
一行文字，产出那一层的壳要剥掉。
"""

from ai_assistant.apps.chat.services import step_preview


def test_no_input_is_none_not_an_empty_table() -> None:
    # 空表与「这一步本来就没有入参」在界面上是两回事：前者会画出一个空框
    assert step_preview.input_preview(None) is None
    assert step_preview.input_preview({}) is None


def test_a_plain_string_value_keeps_its_quotes_off() -> None:
    flat = step_preview.input_preview({"node_id": "n-1"})
    assert flat == {"node_id": "n-1"}


def test_a_nested_value_is_flattened_to_one_line_of_json() -> None:
    flat = step_preview.input_preview({"geometry": {"x": 1, "y": 2}})
    assert flat is not None
    assert flat["geometry"] == '{"x": 1, "y": 2}'


def test_a_long_value_is_cut_and_says_so() -> None:
    flat = step_preview.input_preview({"text": "点" * 900})
    assert flat is not None
    value = flat["text"]
    assert len(value) < 900
    # 静默截断会让人把半份入参当成全部
    assert "已截断" in value


def test_too_many_keys_are_counted_not_dropped() -> None:
    given = {f"k{index}": index for index in range(step_preview.MAX_KEYS + 3)}
    flat = step_preview.input_preview(given)
    assert flat is not None
    assert len(flat) == step_preview.MAX_KEYS + 1
    assert "另有 3 项未摊开" in "".join(flat.values())


def test_the_stored_body_wrapper_is_peeled_off() -> None:
    # 落库时结果包了一层，连壳显示的话每一步的产出前面都顶着一个 {"body": "
    assert (
        step_preview.output_preview({"body": "一共 3 个点位"})
        == "一共 3 个点位"
    )


def test_an_output_without_the_wrapper_still_renders() -> None:
    assert step_preview.output_preview({"count": 3}) == '{"count": 3}'


def test_a_long_output_is_cut_and_says_so() -> None:
    text = step_preview.output_preview({"body": "位" * 5000})
    assert text is not None
    assert len(text) < 5000
    assert "已截断" in text


def test_no_output_is_none() -> None:
    assert step_preview.output_preview(None) is None
    assert step_preview.output_preview({}) is None
