# Public release and verification

Nexus BCI is published at [zook111/Nexus_BCI](https://github.com/zook111/Nexus_BCI).

## Initial publication

This repository starts from a reviewed source snapshot, not a copied development Git directory. It does not import the previous development history, closed-PR discussions, local agent configuration, environment files, logs, recordings or participant exports.

The software licence is **MIT**, copyright **2026 Nexus BCI contributors**. The maintainer confirmed redistribution permission for the bundled generated audio on **10 October 2026**; [MEDIA.md](../MEDIA.md) records its separate provenance and scope. Original branding and synthetic screenshots accompany the software.

## What is checked

- Gitleaks scans the publication tree and reachable history with credentials redacted.
- CI lints and tests Python and TypeScript, and builds the frontend.
- Native macOS checks cover launcher ownership, recoverable migration, custom destinations and process/lock safety.
- Browser requests use a local-origin allowlist for HTTP and WebSocket traffic; this does not authenticate native local processes.
- Tests and documentation separate synthetic rehearsal from participant data and classifier performance.

Scanner success does not prove absence of every secret or private detail. Binary contents, external attachments, local storage and future contributions need separate review.

## Before each release

1. Run the backend, frontend and native checks appropriate to the change. Record the exact revision and tested platforms.
2. Scan staged files and history for credentials and private material. Review new media and screenshots manually.
3. Confirm media provenance and redistribution rights. Preserve copyright and licence notices.
4. Update the README, student guide, current project status and platform limitations.
5. Review the PR, resolve comments, and allow at least five minutes on the latest revision before merging.

## Current limits

Clean installation and synthetic acquisition are verified on the development Mac; independent Intel Mac and physical-headset verification remain incomplete. Publish results as experimental education/research software. Task labels describe instructions; they are not verified thoughts, attention, relaxation or clinical states. The API is for trusted local use and must not be exposed as an unauthenticated public service.
