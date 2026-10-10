# Security and local data

Nexus is a local research tool. Its API can control a connected board, read and delete recordings, and manage demo sessions. It validates browser Origin headers for HTTP and WebSocket requests using the configured local origin allowlist. Native clients without Origin headers remain supported. This is not authentication for local processes. It is not designed to be hosted on the public internet. The macOS launcher binds both services to `127.0.0.1`; keep development servers on loopback too.

Recordings, labels and reports stay in the configured local recording directory. Demo-room names and results stay in a local SQLite database under `data/`. Git ignores these directories, environment files, logs and common raw EEG export formats. An alternative storage path is your responsibility to keep private. Use participant codes rather than names, and do not attach raw participant data to public issues or pull requests.

No API key is needed for acquisition, classification or the maths lesson. Optional Cartesia speech sends cue text to Cartesia; browser speech is the fallback. Never put a secret into a `VITE_*` variable: frontend variables are embedded in downloadable JavaScript. The optional auto-connect serial is device configuration, not a credential.

If you find a vulnerability or accidentally committed credential, use [GitHub private vulnerability reporting](https://github.com/zook111/Nexus_BCI/security/advisories/new) to contact maintainer **zook111**. Do not post credentials or participant recordings in an issue. If GitHub private vulnerability reporting is enabled, use the repository's **Security → Report a vulnerability** page.

Rotate an exposed credential before removing it from source. A deletion does not remove Git history, pull-request diffs, clones or caches. The repository runs Gitleaks on pull requests and main; automated scanning reduces risk but cannot prove the absence of every secret or private detail.
