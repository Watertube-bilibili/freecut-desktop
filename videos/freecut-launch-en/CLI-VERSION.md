# CLI version

Read-only probe on 2026-09-07, before authoring checks:

```text
npx --yes hyperframes@latest upgrade --project . --check --json
```

The result reported HyperFrames **0.8.30** as both the running and latest version, with `updateAvailable: false` and `changed: false`. Existing package scripts already pin 0.8.30. No version upgrade was made.

Application builds, application dependencies, and the earlier Chinese projects were not changed by this probe. The full composition check and render will be recorded after the actual English screenshots are available.
