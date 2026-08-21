# Track & Graph Web

Self-hosted, multi-user web implementation compatible with [Track & Graph](https://github.com/SamAmco/track-and-graph).

## Status

The first runnable slice is available: accounts, private user data, groups, trackers and timestamped data points. Import/export compatibility, graphs, reminders, functions and Lua support are still in development.

## Run locally with Docker

1. Copy `.env.example` to `.env` and replace all example passwords.
2. Run `docker compose up --build`.
3. Open `http://localhost:3080` and sign in with the configured bootstrap account, or register an account while `ALLOW_REGISTRATION=true`.

For a VPS, place the application behind an HTTPS reverse proxy and set `APP_ORIGIN` to its public URL. Use a unique, long `POSTGRES_PASSWORD`, then set `ALLOW_REGISTRATION=false` once the intended accounts exist.

## Goals

- Preserve the core Track & Graph experience: trackers, groups, data points, notes, reminders, functions, graphs, statistics and Lua graphs.
- Import and export the upstream application's group CSV and complete SQLite backup formats.
- Keep each user's data private by default, with authentication and workspace isolation.
- Be straightforward to self-host on a LAN or VPS using Docker Compose.

## Architecture direction

The web app will use its own multi-user database rather than sharing the Android application's SQLite database directly. A versioned compatibility layer will translate between the internal data model and the upstream CSV/SQLite formats. See [UPSTREAM.md](UPSTREAM.md) and [the compatibility plan](docs/compatibility.md).

## License

This project is licensed under GPL-3.0-or-later. The upstream project is also GPL-3.0-or-later; copyright and source-distribution obligations are retained for all derived work.
