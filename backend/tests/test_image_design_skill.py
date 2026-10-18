import asyncio
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest

from app.agent import image_design_skill
from app.chat.conversations import create_conversation
from app.db import connect, init_db
from app.domain import ModelResponse
from app.models import ModelProviderError
from app.workspace import use_workspace
from test_chat_image_generation import response, runtime


def test_image_design_skill_preserves_exact_request_and_loads_bundled_guidance():
    prompt = '生成一张会员活动 Banner。\n紫色与奶白，3:1，主体在右，左侧 40% 留白。不要任何文字。'
    submitted = image_design_skill.image_design_prompt(prompt)
    assert submitted.startswith(prompt + '\n\n')
    assert 'image-design · v1' in submitted
    assert '用户需求优先' in submitted
    assert '不擅自固定左右位置或留白百分比' in submitted
    assert '## 图片设计规范' in submitted
    assert 'name: image-design' not in submitted  # Metadata is not image content.


@pytest.mark.parametrize('definition', ['', 'not a skill', '---\nname: wrong\nversion: 1\n---\nguidance',
                                         '---\nname: image-design\nversion: invalid\n---\nguidance'])
def test_invalid_skill_fails_locally(tmp_path, monkeypatch, definition):
    path = tmp_path / 'SKILL.md'
    path.write_text(definition, encoding='utf-8')
    monkeypatch.setattr(image_design_skill, 'IMAGE_DESIGN_SKILL_PATH', path)
    with pytest.raises(ModelProviderError) as error:
        image_design_skill.image_design_prompt('画一只猫')
    assert error.value.code == 'image_design_skill_unavailable'


def test_missing_skill_does_not_start_a_paid_operation(tmp_path, monkeypatch):
    monkeypatch.setattr(image_design_skill, 'IMAGE_DESIGN_SKILL_PATH', tmp_path / 'missing.md')
    provider = NS(name='images', generate=AsyncMock(return_value=response()))
    with use_workspace(1, tmp_path):
        init_db(); cid = create_conversation('缺少设计技能')['id']
        result = asyncio.run(runtime(provider, 'gpt-image-2').run('画一只猫', conversation_id=cid, run_id='missing-skill'))
        assert result.error.code == 'image_design_skill_unavailable'
        provider.generate.assert_not_awaited()
        with connect() as conn:
            assert conn.execute('SELECT COUNT(*) FROM chat_image_operations').fetchone()[0] == 0


@pytest.mark.parametrize('model', ['gpt-image-2', 'grok-4.7'])
def test_image_design_is_used_by_both_image_paths_and_replay_keeps_original_prompt(tmp_path, monkeypatch, model):
    provider = NS(name='fake', generate=AsyncMock(return_value=response()))
    prompt = '生成一张会员 Banner，紫色与奶白，3:1，主体在右侧，左侧 40% 留白，不要文字。'
    with use_workspace(1, tmp_path):
        init_db(); cid = create_conversation('自动加载设计技能')['id']
        agent = runtime(provider, model)
        agent._generate_for_stage = AsyncMock(side_effect=AssertionError('No extra text-model call'))
        result = asyncio.run(agent.run(prompt, conversation_id=cid, run_id='skill-image'))
        assert result.status == 'done'
        submitted = provider.generate.call_args.args[0].messages[0].content
        assert submitted.startswith(prompt + '\n\n') and 'image-design · v1' in submitted
        assert result.image_generation_prompt == submitted
        changed_skill = tmp_path / 'SKILL.md'
        changed_skill.write_text('---\nname: image-design\nversion: 2\n---\n新的设计规范', encoding='utf-8')
        monkeypatch.setattr(image_design_skill, 'IMAGE_DESIGN_SKILL_PATH', changed_skill)
        replay = asyncio.run(agent.run(prompt, conversation_id=cid, run_id='skill-image'))
        assert replay.image_generation_prompt == submitted
        assert '新的设计规范' not in replay.image_generation_prompt
        provider.generate.assert_awaited_once()
        agent._generate_for_stage.assert_not_awaited()


def test_regular_chat_and_prompt_only_requests_do_not_load_image_skill(tmp_path, monkeypatch):
    def unexpected(_):
        raise AssertionError('Text tasks must not load the image-design skill')
    monkeypatch.setattr(image_design_skill, 'image_design_prompt', unexpected)
    with use_workspace(1, tmp_path):
        init_db(); cid = create_conversation('普通聊天')['id']
        provider = NS(name='fake', generate=AsyncMock(return_value=ModelResponse(content='你好')))
        result = asyncio.run(runtime(provider, 'chat-model').run('你好', conversation_id=cid))
        assert result.content == '你好'
        images = NS(name='images', generate=AsyncMock(return_value=response()))
        result = asyncio.run(runtime(images, 'gpt-image-2').run('帮我生成一张小猫图的提示词', conversation_id=cid))
        assert result.error.code == 'image_prompt_required'
        images.generate.assert_not_awaited()
