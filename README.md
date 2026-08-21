# Track & Graph Web

Self-hosted, multi-user web implementation compatible with [Track & Graph](https://github.com/SamAmco/track-and-graph).

## Status

The project is in its planning and compatibility-discovery phase. It does not yet provide a deployable application.

## Goals

- Preserve the core Track & Graph experience: trackers, groups, data points, notes, reminders, functions, graphs, statistics and Lua graphs.
- Import and export the upstream application's group CSV and complete SQLite backup formats.
- Keep each user's data private by default, with authentication and workspace isolation.
- Be straightforward to self-host on a LAN or VPS using Docker Compose.

## Architecture direction

The web app will use its own multi-user database rather than sharing the Android application's SQLite database directly. A versioned compatibility layer will translate between the internal data model and the upstream CSV/SQLite formats. See [UPSTREAM.md](UPSTREAM.md) and [the compatibility plan](docs/compatibility.md).

## License

The upstream project is GPL-3.0-or-later. This repository is intended to be released under GPL-3.0-or-later before application code is published; copyright and source-distribution obligations will be retained for all derived work.
