# Compatibility plan

## Contract to preserve

The Android app supports two separate exchange mechanisms:

- CSV import/export for a group's tracked data.
- Full backup/restore as an SQLite database containing tracked data, graphs, reminders and notes.

The web app will implement both as versioned adapters. It will not treat its production PostgreSQL database as an Android backup file.

## Test gates

For every supported upstream release, retain non-sensitive fixtures and run:

1. Android export → web import
2. web import → web export → Android restore
3. CSV import and export using representative labels, notes, timestamps, durations and values
4. graph and statistic golden tests, including time zones and daylight-saving transitions
5. Lua API and community-script compatibility tests

## Initial discovery work

- Pin the first supported upstream commit and Android app version.
- Map the SQLite schema, migrations, CSV columns and value encodings.
- Inventory every visible feature and mark it as required, implemented, tested or intentionally deferred.
- Determine the precise Lua 5.2-compatible sandbox/API required by existing scripts.
