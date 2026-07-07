# BossCopilot

Personal BOSS recruitment assistant for higher-quality resume delivery.

## Local Development

### One-command Start

```bash
./scripts/dev.sh
```

This starts both services in the background and writes logs to `logs/`.

To stop both services:

```bash
./scripts/stop-dev.sh
```

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://127.0.0.1:8000`.
For access from another device on the same network, start it with:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://127.0.0.1:5173`.
For another device on the same network, open `http://<this-machine-lan-ip>:5173`.

## Current MVP Scope

- Profile and preference setup
- Local job storage
- Match scoring placeholder
- Delivery queue placeholder
- Application tracking foundation
