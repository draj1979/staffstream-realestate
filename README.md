# Staffstream

Single-tenant SaaS MVP: an AI sales agent for a real estate builder that
talks to leads over WhatsApp. See [CLAUDE.md](./CLAUDE.md) for project
scope and conventions.

## Tech stack

Next.js (App Router, TypeScript) · Tailwind CSS · Prisma · PostgreSQL ·
Anthropic Claude API · Google Cloud Storage · Cloud Run

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in real values:

```bash
cp .env.example .env.local
```

`.env.local` is gitignored and is loaded by both `next dev` and the Prisma
CLI — see `.env.example` for what each variable is for.

### 3. Set up the database

Point `DATABASE_URL` in `.env.local` at a running PostgreSQL instance.
Locally that's easiest via Homebrew:

```bash
brew install postgresql@17
brew services start postgresql@17
createdb staffstream
createdb staffstream_shadow   # used by `prisma migrate dev` to diff schema changes
```

`SHADOW_DATABASE_URL` in `.env.local` points at `staffstream_shadow` — it's
set explicitly (via `prisma.config.ts`) rather than left for Prisma to
auto-create, since Postgres's implicit `template1` default template can
otherwise leak schema into it. Don't use a database named `template1` for
anything in this project.

Then apply migrations:

```bash
npx prisma migrate dev
```

### 4. Seed the builder admin

```bash
npm run seed:admin
```

Reads `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env.local`, bcrypt-hashes the
password, and upserts the single admin `User` row. The plaintext password
is never stored or logged — only the hash is written to the database.

### 5. Configure Google Cloud Storage

Brochure PDFs are stored in GCS. Set `GCS_BUCKET_NAME` / `GCS_PROJECT_ID` in
`.env.local` to a bucket you have access to, and make sure Application
Default Credentials are available (`gcloud auth application-default login`
locally; the attached service account on Cloud Run in production).

### 6. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app, then
sign in at `/login` with the seeded admin credentials.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — lint the codebase
- `npm run seed:admin` — create/update the single builder admin user
