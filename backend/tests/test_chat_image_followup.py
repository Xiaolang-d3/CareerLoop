import pytest

from app.chat.conversations import create_conversation
from app.chat.image_followup import resolve_image_followup
from app.chat.image_assets import image_generation_intent
from app.db import connect, init_db


@pytest.fixture
def previous_image(tmp_path):
    path = tmp_path / "followup.db"
    init_db(path)
    cid = create_conversation("续图", path)["id"]
    with connect(path) as conn:
        uid = conn.execute("INSERT INTO chat_messages(conversation_id,role,content) VALUES (?,'user',?)",
                           (cid, "生成一张小猫玩小鱼玩具图")).lastrowid
        aid = conn.execute("INSERT INTO chat_messages(conversation_id,role,content) VALUES (?,'assistant','')", (cid,)).lastrowid
        conn.execute("INSERT INTO chat_image_operations(id,conversation_id,status) VALUES ('image',?,'done')", (cid,))
        conn.execute("INSERT INTO chat_image_assets(id,operation_id,conversation_id,message_id,provider_item_id,stored_path,metadata_json) "
                     "VALUES ('asset','image',?,?,'mock','mock.png','{}')", (cid, aid))
    return path, cid, uid, aid


@pytest.mark.parametrize("text", ["再生成一张", "再来一张", "重新生成一张", "请再画一幅图！"])
def test_explicit_repeat_reuses_only_the_immediate_image_request(previous_image, text):
    path, cid, _, _ = previous_image
    resolved = resolve_image_followup(text, cid, path)
    assert "小猫玩小鱼玩具" in resolved
    assert "仅生成一张新图片" in resolved
    assert image_generation_intent(resolved)


@pytest.mark.parametrize("text", ["你好", "这张怎么样", "为什么再生成一张", "再生成一张的提示词", "不要再生成一张", "总结文档\n再生成一张", "再生成一张，只要提示词"])
def test_history_does_not_authorize_a_new_image(previous_image, text):
    path, cid, _, _ = previous_image
    assert resolve_image_followup(text, cid, path) == text


def test_consecutive_repeats_reuse_durable_prompt_without_growing(previous_image):
    path, cid, uid, aid = previous_image
    prompt = resolve_image_followup("再生成一张", cid, path)
    with connect(path) as conn:
        conn.execute("UPDATE chat_messages SET content='再生成一张' WHERE id=?", (uid,))
        conn.execute("INSERT INTO agent_execution_runs(run_id,conversation_id,user_message_id,assistant_message_id,user_content,status) "
                     "VALUES ('prior',?,?,?,?,'completed')", (cid, uid, aid, prompt))
    assert resolve_image_followup("再生成一张", cid, path) == prompt


def test_new_repeat_recovers_subject_after_an_earlier_rejected_repeat(previous_image):
    path, cid, _, _ = previous_image
    with connect(path) as conn:
        conn.execute("INSERT INTO chat_messages(conversation_id,role,content) VALUES (?,'user','再生成一张')", (cid,))
        conn.execute("INSERT INTO chat_messages(conversation_id,role,content) VALUES (?,'assistant','当前无法生成图片')", (cid,))
    assert "小猫玩小鱼玩具" in resolve_image_followup("再生成一张", cid, path)


@pytest.mark.parametrize("boundary", ["other_conversation", "text_reply", "no_asset", "cleared_context", "memory_disabled", "unresolved_subject"])
def test_repeat_does_not_cross_context_boundaries(previous_image, boundary, monkeypatch):
    path, cid, uid, aid = previous_image
    with connect(path) as conn:
        if boundary == "other_conversation":
            cid = create_conversation("其他对话", path)["id"]
        elif boundary == "text_reply":
            conn.execute("INSERT INTO chat_messages(conversation_id,role,content) VALUES (?,'user','你好')", (cid,))
            conn.execute("INSERT INTO chat_messages(conversation_id,role,content) VALUES (?,'assistant','你好')", (cid,))
        elif boundary == "no_asset":
            conn.execute("DELETE FROM chat_image_assets WHERE message_id=?", (aid,))
        elif boundary == "cleared_context":
            conn.execute("UPDATE conversations SET context_cutoff_message_id=? WHERE id=?", (aid, cid))
        elif boundary == "memory_disabled":
            monkeypatch.setattr("app.chat.image_followup.get_agent_settings", lambda *args: {"conversation_memory_enabled": False})
        elif boundary == "unresolved_subject":
            conn.execute("UPDATE chat_messages SET content='再生成一张' WHERE id=?", (uid,))
    assert resolve_image_followup("再生成一张", cid, path) == "再生成一张"
