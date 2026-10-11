import asyncio
import base64
import json
from io import BytesIO
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
from PIL import Image

from app.agent.runtime import AgentRuntime
from app.chat.image_assets import (asset_file, asset_thumbnail, begin_generation, delete_images,
                                   image_generation_intent, persist_images)
from app.chat.artifacts import SaveArtifactIn, message_artifacts, save_artifact
from app.chat.conversations import create_conversation
from app.chat.service import save_stream_result
from app.db import connect, init_db, json_dump
from app.domain import AgentMessage, AgentRunResult, ModelRequest, ModelResponse, ModelStreamEvent
from app.domain.agent import ModelImageOutput
from app.models import ModelProviderError, ModelProviderRegistry
from app.models.auto_negotiating import AutoNegotiatingModelProvider
from app.models.openai_responses import OpenAIResponsesProvider
from app.library.sources import delete_source, get_source_asset, get_source_file
from app.tools import ToolRegistry
from app.workspace import use_workspace


def png():
    buf = BytesIO()
    Image.new('RGB', (32, 16), 'blue').save(buf, 'PNG')
    return buf.getvalue()


def response(text=''):
    return ModelResponse(content=text, images=[ModelImageOutput(item_id='ig_mock', base64_data=base64.b64encode(png()).decode())],
                         output_blocks=([{'type': 'text', 'text': text}] if text else []) + [{'type': 'image', 'index': 0}])


@pytest.fixture
def images(tmp_path):
    path = tmp_path / 'images.db'
    init_db(path)
    conversation = create_conversation('生图测试', path)
    return path, conversation['id']


@pytest.mark.parametrize('prompt,expected', [('帮我生成一张图片：海边灯塔', True), ('画一只蓝色的猫', True),
    ('Generate an image of a cat', True), ('请解释如何生成图片', False), ('生成图片的原理是什么', False),
    ('总结这份文档\n帮我生成一张图片', False), ('整理成思维导图', False), ('生成一个图表', False),
    ('帮我画个思维导图', False), ('绘制流程图', False), ('可以生成图片吗', False), ('生成图片需要多少钱', False)])
def test_intent(prompt, expected):
    # A question about generating images is not an instruction to buy one.
    assert image_generation_intent(prompt) == expected


def test_image_bytes_never_serialized():
    result = response('说明')
    assert 'base64_data' not in result.model_dump_json()
    assert base64.b64encode(png()).decode() not in repr(result)


def test_provider_native_output_order_and_dedup():
    provider = OpenAIResponsesProvider(api_key='test-key', model='grok-4.7', base_url='https://provider.invalid/v1')
    item = NS(type='image_generation_call', id='ig_mock', status='completed', result=base64.b64encode(png()).decode())
    raw = NS(status='completed', output=[NS(type='message', content=[NS(type='output_text', text='前言')]), item, item,
                                        NS(type='message', content=[NS(type='output_text', text='后记')])], usage=None)
    parsed = provider._response_from_response(raw)
    assert parsed.content == '前言\n\n后记' and len(parsed.images) == 1
    assert [b['type'] for b in parsed.output_blocks] == ['text', 'image', 'text']
    args = provider._request_arguments(ModelRequest(messages=[AgentMessage(role='user', content='画一只猫')], image_generation=True))
    assert args['tools'] == [{'type': 'image_generation', 'action': 'generate'}]
    assert 'tool_choice' not in args
    item.status = 'in_progress'
    with pytest.raises(ModelProviderError, match='完整图片'):
        provider._response_from_response(raw)


def test_native_stream_collects_final_item_without_base64_events():
    provider = OpenAIResponsesProvider(api_key='test-key', model='grok-4.7', base_url='https://provider.invalid/v1')
    image = NS(type='image_generation_call', id='ig_mock', status='completed', result=base64.b64encode(png()).decode())
    class Stream:
        async def __aiter__(self):
            for event in [NS(type='response.image_generation_call.generating'), NS(type='response.output_item.done', item=image),
                          NS(type='response.completed', response=NS(output=[], status='completed', usage=None))]:
                yield event
        async def close(self): pass
    create = AsyncMock(return_value=Stream())
    provider._client = NS(with_options=lambda **kwargs: NS(responses=NS(create=create)))
    async def collect(): return [event async for event in provider.stream(ModelRequest(messages=[], image_generation=True))]
    events = asyncio.run(collect())
    assert [e.type for e in events] == ['image_progress', 'completed']
    assert len(events[-1].response.images) == 1
    assert base64.b64encode(png()).decode() not in str([e.model_dump() for e in events])


def test_native_never_falls_back():
    wrong = NS(generate=AsyncMock(return_value=ModelResponse(content='wrong')))
    native = NS(generate=AsyncMock(side_effect=ModelProviderError('protocol_not_supported', '服务拒绝', True)))
    provider = AutoNegotiatingModelProvider([('openai', wrong), ('responses', native)], 'mock-image-test')
    with pytest.raises(ModelProviderError):
        asyncio.run(provider.generate(ModelRequest(messages=[], image_generation=True)))
    assert native.generate.await_count == 1 and wrong.generate.await_count == 0


def test_storage_replay_manifest_and_independent_archives(images):
    path, cid = images
    assert begin_generation('op', cid, {}, path) is None
    result = persist_images('op', response('图片说明'), 'grok-4.7', path)
    assert begin_generation('op', cid, {}, path) == result
    assert persist_images('op', response(), 'grok-4.7', path) == result
    asset = result['assets'][0]
    file, _, mime = asset_file(asset['id'], path)
    assert file.read_bytes() == png() and mime == 'image/png'
    assert file.stat().st_mode & 0o777 == 0o600
    assert Image.open(BytesIO(asset_thumbnail(asset['id'], path))).size == (32, 16)
    with connect(path) as conn:
        mid = conn.execute("INSERT INTO chat_messages(conversation_id,role,content,payload_json) VALUES (?,'assistant',?,?)",
                           (cid, result['content'], json_dump({'agent': {'status': 'done', **result}}))).lastrowid
        conn.execute('UPDATE chat_image_assets SET message_id=? WHERE id=?', (mid, asset['id']))
    manifest = message_artifacts(mid, path)
    assert [a['kind'] for a in manifest['artifacts']] == ['answer', 'image']
    mixed = save_artifact(mid, SaveArtifactIn(selector='answer', snapshot=manifest['snapshot'], filename='回答.md'), path)['source']
    single = save_artifact(mid, SaveArtifactIn(selector=f"asset:{asset['id']}", snapshot=manifest['snapshot'], filename='猫.png'), path)['source']
    archived = get_source_asset(mixed['id'], asset['id'], path)[0]
    assert archived != file and archived.read_bytes() == png()
    delete_images(cid, message_cutoff=mid, db_path=path)
    assert not file.exists() and archived.exists()
    assert get_source_file(single['id'], path)[0].read_bytes() == png()
    assert f"assets/{asset['id']}.png" in get_source_file(mixed['id'], path)[0].read_text()
    assert delete_source(mixed['id'], path) and not archived.exists()
    with pytest.raises(ValueError): asset_file(asset['id'], path)


def test_pending_no_retry_foreign_and_invalid_images(images):
    path, cid = images
    begin_generation('pending', cid, {'model_name': 'grok-4.7'}, path)
    with pytest.raises(ModelProviderError, match='阻止'): begin_generation('pending', cid, {'model_name': 'grok-4.7'}, path)
    with pytest.raises(ModelProviderError, match='版本'): begin_generation('pending', cid, {}, path)
    with pytest.raises(ModelProviderError):
        persist_images('pending', ModelResponse(images=[ModelImageOutput(item_id='ig_bad', base64_data='not-a-png')]), 'grok-4.7', path)
    with connect(path) as conn: assert conn.execute('SELECT COUNT(*) FROM chat_image_assets').fetchone()[0] == 0
    with pytest.raises(ValueError): asset_file('../elsewhere', path)


def runtime(provider, model='grok-4.7'):
    registry = ModelProviderRegistry(); registry.register(provider.name, provider)
    return AgentRuntime(registry, ToolRegistry(), provider.name, 'local', 4, max_model_retries=3,
                        model_selection={'profile_id': 'p', 'connection_id': 'c', 'profile_revision': 1,
                                         'connection_revision': 1, 'model_name': model, 'model_protocol': 'auto'})


def test_runtime_pure_image_and_no_auto_retry(images):
    path, cid = images
    provider = NS(name='fake', generate=AsyncMock(return_value=response()))
    with use_workspace(1, path.parent):
        # workspace default database differs from explicit fixture database
        init_db(); cid = create_conversation('纯图片')['id']
        result = asyncio.run(runtime(provider).run('画一只猫', conversation_id=cid, run_id='pure-image'))
        assert result.status == 'done' and result.content == '' and len(result.assets) == 1
        assert provider.generate.await_count == 1 and provider.generate.call_args.args[0].image_generation
        failed = NS(name='fake', generate=AsyncMock(side_effect=ModelProviderError('timeout', '请求超时', True)))
        result = asyncio.run(runtime(failed).run('画一只猫', conversation_id=cid, run_id='failed-image'))
        assert result.status == 'failed' and not result.error.retryable and failed.generate.await_count == 1
        result = asyncio.run(runtime(failed).run('画一只猫', conversation_id=cid, run_id='failed-image'))
        assert result.error.code == 'image_generation_uncertain' and failed.generate.await_count == 1
        wrong = asyncio.run(runtime(provider, 'other').run('画一只猫', conversation_id=cid))
        assert wrong.error.code == 'image_model_required' and provider.generate.await_count == 1


def test_image_api_private_archive_and_account_isolation(tmp_path, monkeypatch):
    from app import db
    from app.main import app
    from app.chat.service import save_chat_message
    from api_client import create_authenticated_client, register_authenticated_client
    monkeypatch.setattr(db, 'DB_PATH', tmp_path / 'api.db')
    init_db()
    owner = create_authenticated_client(app)
    other = register_authenticated_client(app, 'image-other@example.com')
    try:
        with use_workspace(1):
            cid = create_conversation('生图 API')['id']
            user = save_chat_message('user', '画一只猫', {}, conversation_id=cid)
            with connect() as conn:
                tid = conn.execute('INSERT INTO conversation_tasks(conversation_id,title) VALUES (?,?)', (cid, '生图')).lastrowid
            begin_generation('api-op', cid, {})
            result = persist_images('api-op', response(), 'grok-4.7')
            saved = save_stream_result(cid, tid, user, AgentRunResult(**result, provider='responses', platform='local', rounds=1))
            mid = saved['assistant_message']['id']; asset = result['assets'][0]
        original_url = f"/chat-assets/{asset['id']}/file"
        thumbnail_url = f"/chat-assets/{asset['id']}/thumbnail"
        assert owner.get(original_url).content == png()
        assert owner.get(thumbnail_url).headers['content-type'] == 'image/webp'
        assert owner.get(thumbnail_url).headers['cache-control'] == 'no-store'
        assert other.get(original_url).status_code == 404
        assert other.get(thumbnail_url).status_code == 404
        manifest = owner.get(f'/chat/messages/{mid}/artifacts').json()
        assert not manifest['artifacts'][0]['can_index']
        request = {'selector': 'answer', 'snapshot': manifest['snapshot'], 'filename': '回答.md'}
        archived = owner.post(f'/chat/messages/{mid}/save-to-library', json=request)
        assert archived.status_code == 200
        source = archived.json()['source']; sid = source['id']
        assert source['content'] == '' and source['text_parse_status'] == 'not_required'
        url = f"/library/sources/{sid}/assets/{asset['id']}/file"
        assert other.get(url).status_code == 404
        assert owner.patch(f'/library/sources/{sid}', json={'enabled': True}).status_code == 422
        assert owner.delete(f"/chat/messages/{user['id']}/tail", params={'conversation_id': cid}).status_code == 200
        assert owner.get(original_url).status_code == 404
        assert owner.get(url).content == png()
        assert owner.get(f"/library/sources/{sid}/assets/not-owned/file").status_code == 404
        token = owner.headers.pop('Authorization')
        assert owner.get(original_url).status_code == 401 and owner.get(url).status_code == 401
        owner.headers['Authorization'] = token
    finally:
        owner.close(); other.close()


def test_symlink_and_foreign_message_refs_are_rejected(images, tmp_path):
    path, cid = images
    begin_generation('symlink-op', cid, {}, path)
    saved = persist_images('symlink-op', response(), 'grok-4.7', path)
    aid = saved['assets'][0]['id']
    file = asset_file(aid, path)[0]
    outside = tmp_path / 'outside.png'; outside.write_bytes(png())
    file.unlink(); file.symlink_to(outside)
    with pytest.raises(ValueError, match='路径'): asset_file(aid, path)
    with connect(path) as conn:
        mid = conn.execute("INSERT INTO chat_messages(conversation_id,role,content,payload_json) VALUES (?,'assistant','',?)", (cid, json_dump({'agent': {'status': 'done', **saved}}))).lastrowid
    with pytest.raises(ValueError, match='当前消息'): message_artifacts(mid, path)


def test_upgrade_28_creates_assets_without_changing_history(images):
    path, cid = images
    with connect(path) as conn:
        conn.execute('DELETE FROM schema_migrations WHERE version=29')
        conn.execute("INSERT INTO schema_migrations(version,name) VALUES (28,'old')")
        conn.execute('DROP TABLE chat_image_assets'); conn.execute('DROP TABLE chat_image_operations')
        mid = conn.execute("INSERT INTO chat_messages(conversation_id,role,content) VALUES (?,'assistant','旧回答')", (cid,)).lastrowid
    init_db(path)
    with connect(path) as conn:
        assert conn.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0] == 29
        assert conn.execute('SELECT content FROM chat_messages WHERE id=?', (mid,)).fetchone()[0] == '旧回答'
        assert conn.execute('SELECT COUNT(*) FROM chat_image_assets').fetchone()[0] == 0


def test_native_stream_replay_and_message_save_are_idempotent(images):
    from app.agent.run_store import AgentRunStore
    from app.chat.service import save_chat_message
    path, _ = images
    class Provider:
        name = 'fake'
        calls = 0
        async def stream(self, request):
            self.calls += 1
            yield ModelStreamEvent(type='image_progress', delta='generating')
            yield ModelStreamEvent(type='completed', response=response())
    provider = Provider()
    with use_workspace(1, path.parent):
        init_db(); cid = create_conversation('流式生图')['id']
        user = save_chat_message('user', '画一只猫', {}, conversation_id=cid)
        with connect() as conn:
            tid = conn.execute('INSERT INTO conversation_tasks(conversation_id,title) VALUES (?,?)', (cid, '生图')).lastrowid
        agent = runtime(provider)
        agent._run_store = AgentRunStore()
        async def collect():
            return [e async for e in agent.run_stream('画一只猫', conversation_id=cid, task_id=tid, run_id='replay-image')]
        first = asyncio.run(collect())
        result = first[-1].result
        assert result.status == 'done' and result.content == ''
        assert any(e.event and e.event.tool_name == 'image_generation' for e in first)
        replayed = asyncio.run(collect())[-1].result
        assert replayed.assets == result.assets and provider.calls == 1
        saved = save_stream_result(cid, tid, user, result)
        again = save_stream_result(cid, tid, user, replayed)
        assert saved['assistant_message']['id'] == again['assistant_message']['id']
        with connect() as conn:
            assert conn.execute("SELECT COUNT(*) FROM chat_messages WHERE conversation_id=? AND role='assistant'", (cid,)).fetchone()[0] == 1


def test_storage_failure_rolls_back_and_keeps_attempt_blocked(images, monkeypatch):
    path, cid = images
    begin_generation('disk-failure', cid, {}, path)
    monkeypatch.setattr('os.open', lambda *args, **kwargs: (_ for _ in ()).throw(OSError('disk unavailable')))
    with pytest.raises(ModelProviderError, match='不会自动重新生成'):
        persist_images('disk-failure', response(), 'grok-4.7', path)
    with connect(path) as conn:
        assert conn.execute('SELECT COUNT(*) FROM chat_image_assets').fetchone()[0] == 0
        assert conn.execute('SELECT status FROM chat_image_operations WHERE id=?', ('disk-failure',)).fetchone()[0] == 'started'
    with pytest.raises(ModelProviderError, match='阻止'):
        begin_generation('disk-failure', cid, {}, path)
