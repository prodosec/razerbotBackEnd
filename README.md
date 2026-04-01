# Razer Backend (Node + Express)

Quick start:

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:

```bash
npm install
```

3. Run in dev mode:

```bash
npm run dev
```

APIs live under `/api/auth`:

- `POST /register` – local signup (name, email, password)
- `POST /login` – local signin (email, password)
- `GET /me` – current user (requires Bearer access token)
- `POST /refresh` – issue new access token with refresh token
- `POST /logout` – invalidate refresh token (requires auth)

Third‑party authentication with Razer is available as well:

- `GET /razer` – redirect to Razer's OAuth consent screen
- `GET /razer/callback` – callback endpoint; returns tokens or can redirect to frontend

You can consult the Razer Web Manual PDF bundled in the repository for the external API flow.
