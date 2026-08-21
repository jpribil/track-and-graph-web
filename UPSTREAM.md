# Upstream tracking

Upstream: <https://github.com/SamAmco/track-and-graph>

This repository is a web reimplementation, not an Android source branch. As a result, upstream commits must **not** be merged into this repository. Kotlin/Android changes are instead reviewed as product and compatibility changes.

## Repository arrangement

- `jpribil/track-and-graph-web` contains the web application.
- A separate, unmodified GitHub fork of the upstream Android project should be kept only for native GitHub fork synchronization and historical reference.
- This repository records its inspected upstream commit, supported Android release versions, fixtures and compatibility decisions in this document and `docs/compatibility.md`.

## Update routine

1. Fetch upstream changes and inspect database migrations, CSV import/export code, graph calculations and Lua API changes.
2. Open a tracking issue describing the user-visible and format-impacting changes.
3. Add or revise Android-originated fixtures and round-trip tests.
4. Implement the change in the web compatibility layer before declaring the corresponding upstream version supported.

## Compatibility rule

Compatibility is versioned and tested. A claim such as "compatible with Track & Graph vX" means that an exported Android database can be imported by the web app and a web-exported database can be restored by that Android version without loss of supported data.
