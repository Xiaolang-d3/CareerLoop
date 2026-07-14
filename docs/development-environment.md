# Development Environment and Editors

## Recommended default: Visual Studio Code

Use VS Code when one editor should cover both the FastAPI backend and React/TypeScript frontend. Open the repository root (`bosscopilot/`) as one workspace.

Recommended extensions:

- Python
- Pylance
- Python Debugger
- Ruff
- ESLint
- Prettier
- Playwright Test for VS Code

VS Code provides Python environment selection, running, debugging, testing, TypeScript/React support, browser debugging, and built-in Git source control. It is the lowest-friction default for this repository.

Do not commit personal VS Code settings. Project-wide settings may be added later only when the formatter, linter, and test commands are finalized.

## Alternative: PyCharm

Use PyCharm when backend refactoring, Python type navigation, FastAPI run/debug configurations, and database inspection are the main work. Current PyCharm editions support FastAPI and web languages; verify edition-specific features before standardizing a team license.

Two-editor JetBrains setup is also valid:

- PyCharm for Python/FastAPI and SQLite
- WebStorm for React, TypeScript, CSS, Vite, and browser debugging

This provides deeper language tooling but consumes more resources and requires switching applications.

## Suggested choice

For the current local MVP:

1. Use **VS Code** as the team default.
2. Allow **PyCharm** as an individual backend preference.
3. Treat editor configuration as optional; the terminal verification commands are authoritative.

## Opening and running the project

Repository root:

```text
/Users/kkxny/BossCopilot/bosscopilot
```

Start both services:

```bash
./scripts/dev.sh
```

Stop both services:

```bash
./scripts/stop-dev.sh
```

Backend-only workflow:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
uvicorn app.main:app --reload --port 8000
```

Frontend-only workflow:

```bash
cd frontend
npm install
npm run dev
```

## Verification baseline

Until dedicated lint and test commands are introduced:

```bash
cd frontend
npm run build
```

Backend verification currently consists of importing the application and calling the health and affected feature endpoints. The product-hardening phase will add automated backend tests and make them part of the required commit checks.

## BOSS read-only mode

The runtime data source is BOSS Zhipin only. Copy `backend/.env.example` to the ignored `backend/.env` file and set:

```text
JOB_PLATFORM=boss
```

Then start the application and say `打开 BOSS 登录` in chat. Complete login only on the official BOSS page. After login, ordinary job-search requests use the registered `search_jobs` tool. The adapter stops and reports a blocked state when login expires, a security verification appears, the page becomes blank, or the supported job-card structure is unavailable.

The application requires the configured OpenAI-compatible model service and does not fall back to a fake or alternate model. Create an ignored `backend/.env` from `backend/.env.example`, set `MODEL_PROVIDER=openai`, `MODEL_NAME`, `OPENAI_API_KEY`, and optionally `MODEL_BASE_URL`, then restart the backend. Authentication, rate-limit, timeout, connection, and provider errors are surfaced as explicit Agent failures. Never commit the local env file or print its secret values in logs.
