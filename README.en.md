# Mizuki-Server

English | [简体中文](./README.md)

A **local-first management server** for the [Mizuki](https://github.com) Astro blog theme. It never touches the theme's source structure — it only does four things:

1. **Content management** — collections (diary / friends / projects / timeline / skills / devices / anime), Markdown posts, rich-text posts, albums, media library, and the about page;
2. **Site configuration** — controlled rewrites of a safe subset of the theme's `src/config.ts` (`lang` / `commentConfig` / `navBarConfig`);
3. **Build & preview** — whitelisted tasks (`install` / `dev` / `build` / `preview`), live SSE logs, and a static `dist` preview channel;
4. **HTTP interface** — JWT admin API (`/api/v1/admin/**`) + rate-limited public API (`/api/v1/public/**`) + a same-origin Vue 3 admin panel.

One command to run in production: `pnpm install && pnpm build`, then `node apps/server/bin/mizuki-server` — the panel and the API are both served on port **20154**.

**Architecture in one sentence**: a pnpm monorepo — `apps/server` (NestJS 11 + Drizzle/SQLite, API + panel on 20154) + `apps/web` (Vue 3 + Element Plus + TipTap/CodeMirror admin panel) + `packages/shared` (shared zod schemas and event contracts); the six collection types treat "files as the database" (ts-morph AST rewrites), while the article index / rich-text / user / logs live in SQLite (12 tables).

## Repository Layout

```
.
├── apps/
│   ├── server/          # NestJS backend (API + static panel hosting, default port 20154)
│   │   ├── bin/mizuki-server   # production entry point (loads dist/main.js)
│   │   └── test/               # unit + e2e tests (546 cases)
│   └── web/             # admin panel (Vue 3 + Element Plus)
├── packages/
│   └── shared/          # shared zod schemas / event contracts
├── docs/
│   ├── MASTER-PLAN.md   # master plan (architecture / API inventory / security)
│   ├── REQUIREMENTS.md  # requirements (field-level specs / hard constraints)
│   ├── STRUCTURE.md     # directory structure notes
│   ├── SECURITY-REVIEW.md  # security review (P11)
│   ├── decisions/       # ADR records (ADR-001 ~ 027)
│   └── prompts/         # phased prompt archive (development methodology)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.mjs    # includes boundaries layering rules
└── package.json
```

## Common Commands

```bash
pnpm install      # install all dependencies (Node >= 22 LTS / pnpm >= 9)
pnpm dev          # start the backend dev server (port 20154, watch mode)
pnpm build        # build the whole workspace (server dist + web dist + shared)
pnpm test         # full backend test suite (unit + e2e, 546 cases)
pnpm lint         # style + layering boundary checks
```

## Quick Start

### Production (one command, panel and API same-origin)

```bash
pnpm install && pnpm build
node apps/server/bin/mizuki-server          # panel / API: http://localhost:20154
```

- Open `http://localhost:20154` to enter the panel. First run goes through the **initialization wizard** (a directory picker detects your Mizuki project, then you set the admin credentials — one-time only).
- After logging in you can manage content, upload media, create/restore backups, and start/stop build tasks. Swagger docs live at `http://localhost:20154/api/v1/docs` (public/admin/system groups). **For public deployment**, set `"swagger": false` in config.json to unmount the docs (enabled locally by default).
- The media/album upload whitelist is **nine extensions** (`jpg/jpeg/png/gif/webp/avif/bmp/tiff/tif`, ADR-017; `svg` stays excluded because it can embed scripts). `bmp` has a two-sided policy: rejected on the media-library path (sharp cannot decode it), accepted on the album path (stored as-is). Files you place into the Mizuki directory manually are unaffected and still render.
- Ports can be overridden with `MIZUKI_SERVER_PORT`; the panel dist directory with `MIZUKI_WEB_DIST` (default `apps/web/dist` — if missing, the backend serves the API only).

### Development (frontend + backend with HMR)

```bash
pnpm dev                                        # terminal 1: backend on 20154
pnpm --filter @mizuki/web dev                   # terminal 2: panel on 20155 (/api proxied to 20154)
```

## API Overview

Global prefix `/api/v1`; admin endpoints (`/admin/**`, `/system/status`) require JWT dual tokens (access 15 min + refresh 7 days with rotation); public endpoints (`/public/**`) are unauthenticated with a global rate limit of 60 req/min (login is separately limited to 5/min). Full inventory in MASTER-PLAN §5 and the Swagger UI (`/api/v1/docs`). **`/public/comments` is permanently not implemented** (ADR-016: comments use the theme's own Twikoo/Giscus; the server builds nothing, the `comment` table is dormant).

Additionally `/site-assets/**` is the **site asset channel** (ADR-012): authenticated hosting of images under the Mizuki `public/` directory (image extensions only, JWT required — panel `<img>` tags pass automatically via the `mizuki_asset_token` cookie; programmatic calls may send a Bearer header), used for media thumbnails, album lightboxes, etc. If the Mizuki directory is not configured, the whole prefix 404s.

## Development Methodology

This project is developed in a **phase-prompt-driven** way: each session completes exactly one phase (P0a → P11). Specs are archived under [`docs/prompts/`](./docs/prompts/), with the entry point at [`INDEX.md`](./docs/prompts/INDEX.md). Full implementation records live in [`docs/SESSIONS.md`](./docs/SESSIONS.md) and [`CHANGELOG.md`](./CHANGELOG.md).

## Documentation Index

- [MASTER-PLAN.md](./docs/MASTER-PLAN.md) — master plan: architecture decisions, API inventory, security notes, coding rules
- [REQUIREMENTS.md](./docs/REQUIREMENTS.md) — requirements: field-level specs, security needs, hard constraints
- [STRUCTURE.md](./docs/STRUCTURE.md) — directory structure notes
- [SECURITY-REVIEW.md](./docs/SECURITY-REVIEW.md) — security review (9 security clauses + 16 hard constraints, checked item by item)
- [DEPLOYMENT-CHECKLIST.md](./docs/DEPLOYMENT-CHECKLIST.md) — deployment checklist and the full environment variable list
- [docs/decisions/](./docs/decisions/) — ADR records (dependency baseline, SQLite accounting, backup scope, JWT admin, static panel hosting, site asset channel, ...)
- [CHANGELOG.md](./CHANGELOG.md) — per-phase delivery records

## License

For personal use alongside the Mizuki theme. See the theme repository for theme licensing.
