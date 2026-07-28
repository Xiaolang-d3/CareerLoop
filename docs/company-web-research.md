# 公司联网研究

BossCopilot 可以通过独立运行的 AgentSearch 服务搜索和读取公开网页，并生成带来源的公司研究报告。联网能力默认关闭，不会访问招聘网站登录态、Cookie 或非公开页面。

## 1. 启动 AgentSearch

AgentSearch 是独立的开源项目。建议将它安装在 BossCopilot 仓库之外：

```bash
git clone https://github.com/brcrusoe72/agent-search.git
cd agent-search
./scripts/prepare-searxng.sh
docker compose up -d
curl http://127.0.0.1:3939/health
```

生产或局域网环境应为 AgentSearch 开启 bearer token。BossCopilot 允许使用明文 HTTP 连接本机回环地址；连接其他主机时必须使用 HTTPS。

## 2. 配置 BossCopilot

在 `backend/.env` 中加入：

```dotenv
WEB_RESEARCH_ENABLED=true
AGENT_SEARCH_BASE_URL=http://127.0.0.1:3939
# AGENT_SEARCH_TOKEN=与 AgentSearch 相同的 bearer token
WEB_RESEARCH_TIMEOUT_SECONDS=25
WEB_RESEARCH_MAX_SOURCES=10
```

重启后端后，`/agent/capabilities` 中的 `web_research.enabled` 应为 `true`，工具列表应包含 `research_company`。

## 3. 使用方式

在工作台填写公司全称，选择“公司背景调查”；也可以在对话中明确提出：

```text
请调查上海示例科技有限公司，重点看核心业务、近期融资、团队稳定性和公开风险。
```

报告应包含：

- 公司身份核验；
- 核心产品与商业模式；
- 近期动态；
- 正面和风险信号；
- 信息冲突与未知项；
- 与目标岗位的关系；
- 建议向 HR 或面试官确认的问题；
- 就近放置的来源链接。

## 4. 安全边界

- 模型不能修改 AgentSearch 服务地址或令牌。
- 搜索结果和网页正文始终作为不可信外部内容处理。
- 返回的来源只接受公开 HTTP/HTTPS 地址，内网、回环和特殊地址会被丢弃。
- 单次研究限制查询数、来源数、响应大小、正文长度和超时时间。
- 网页中的提示词或操作指令不能扩大工具权限。
- 系统不登录网站、不读取 Cookie、不绕过验证码。
- 公开员工评价只能作为主观信号，不能直接表述为已验证事实。

## 5. 故障排查

- `web_research_disabled`：确认 `WEB_RESEARCH_ENABLED=true` 并重启后端。
- `agent_search_unavailable`：检查 `curl http://127.0.0.1:3939/health`。
- HTTP 401/403：确认两端 bearer token 一致。
- `company_sources_not_found`：补充公司全称、城市、行业或官网，避免同名实体误判。
