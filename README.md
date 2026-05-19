# CTR API

Fastify + TypeScript backend for the CTS-R CBT supervision platform.

## Features

- Resource-oriented REST API under `/api/v1`
- Swagger UI at `/docs`
- JWT authentication
- Session, transcript, AI analysis, evidence, scoring, feedback, report, and analytics endpoints
- Postgres migrations and CTS-R reference seed data in `src/db`
- Postgres-backed store when `DATABASE_URL` is configured, with in-memory fallback for local development without a database
- n8n client that submits transcript text as multipart field `data0`

## Quick Start

```bash
npm install
cp .env.example .env
npm run db:seed
npm run dev
```

Open `http://localhost:4000/docs`.

For the full local setup with Docker Postgres, frontend env, backend env, and seed users, see `../SETUP.md`.

If `DATABASE_URL` is set, the API runs `001_initial_schema.sql` and `001_ctsr_reference.sql` on startup. `npm run db:seed` also creates local dev users:

- `supervisor@thera.app / demo1234`
- `therapist@thera.app / demo1234`
