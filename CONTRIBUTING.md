# Contributing to Nexus

Created and maintained by **[zook111](https://github.com/zook111)**.

Start with the [README](README.md) and use the synthetic board when developing without hardware. Keep each change focused, open a pull request, and describe what changed and how you checked it. Do not commit recordings, participant information, credentials, local environment files or generated agent caches. Use synthetic fixtures and screenshots.

Run the checks before submitting:

```bash
.venv/bin/ruff check backend
.venv/bin/pytest backend
npm run lint --prefix frontend
npm test --prefix frontend -- --run
npm run build --prefix frontend
```

For launcher changes on macOS, also run `./script/test_desktop_launcher.sh` and `./script/test_launcher_install.sh`. Preserve signal-quality gates, the explicit distinction between synthetic rehearsal and participant results, and separate training/test recordings. Report hardware verification separately from software tests.

Internal Python imports, environment variables and the legacy launcher state directory retain the `mindmeld` name for installation compatibility. User-facing copy and new brand assets use **Nexus**.

Contributions are made under the software MIT licence. Retain zook111 copyright notices and provide authorship credit for contributions. Bundled audio has separate provenance in [MEDIA.md](MEDIA.md); do not add media without redistribution rights. Generated scratch artifacts stay outside tracked docs; only reviewed, shareable guides belong under `docs/`.
