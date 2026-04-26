# Deploy

## Backend on Render

- Render can read `render.yaml` directly from the repo root.
- The Render config pins Python to `3.11.11`, which is a safer target for the current scientific stack (`numpy`, `scipy`, `scikit-learn`, `xgboost`).
- The backend installs only the runtime packages from `requirements-render.txt`.
- Start command: `uvicorn src.api.main:app --host 0.0.0.0 --port $PORT`
- Optional environment variables:
  - `CORS_ORIGINS`: comma-separated list of custom frontend origins
  - `CORS_ORIGIN_REGEX`: defaults to `https://.*\\.vercel\\.app` for Vercel preview deployments

## Frontend on Vercel

- Vercel can deploy the repo root using `vercel.json`.
- The config builds the CRA app inside `frontend/` and serves `frontend/build`.
- Vercel should also get a server environment variable named `RENDER_API_URL` pointing at the Render backend URL.
- Do not set `REACT_APP_API_URL` on Vercel. The frontend uses `http://localhost:8000` automatically in local development and `/api` in production, so browser requests go through the Vercel proxy in `api/[...path].js`.

## Recommended flow

1. Deploy the backend to Render first and copy the Render service URL.
2. Set `RENDER_API_URL` in Vercel to that Render URL.
3. Redeploy the frontend so the proxy can forward prediction requests to Render.
