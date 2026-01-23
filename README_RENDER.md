# Guiding Backend (Supabase + Render)

This backend replaces the old SQLite prototype. It uses:
- Supabase Auth (mobile app logs in directly)
- Supabase Postgres tables for tours/tickets/availability
- Render (or any Node host) for API endpoints and business logic

## Environment variables (Render)
Set these in Render dashboard:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

Optional (local dev):
- PORT=3000

## Run locally
```bash
cd backend
npm install
npm start
```

Health check:
- GET /api/health

## Mobile configuration
Set in `mobile/.env`:
- EXPO_PUBLIC_API_URL=https://<your-render-service>.onrender.com

## Auth
Mobile must call Supabase auth and then call this API with:
`Authorization: Bearer <supabase_access_token>`
