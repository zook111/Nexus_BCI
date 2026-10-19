# Student app updates

Status: user approved the offered Update and restart behaviour on 19 October 2026. Implementation uses the launcher before starting services.

## Purpose

Students with no coding experience should receive app and guide improvements without opening Terminal or typing Git commands. This applies to the existing source installation on an Intel MacBook running Ventura, using the Nexus Server desktop launcher.

## Proposed experience

The proposed default is an update offer when the student opens Nexus Server to start the app. Before starting local services, check for a newer reviewed version on the public repository's main branch. When an update is available, offer **Update and start** or **Not now**. Explain that installation needs internet, may take several minutes and must finish before using the app. Not now starts the installed version.

The check has a short network timeout. Being offline, rate-limited or unable to check must not stop the installed app from opening. Installation failures must report failure rather than claiming the app is current.

If the app is already running, keep the existing launcher action that stops it. Do not check or install updates in that stop path. Never stop an active app in order to install an update. Students save their work, stop Nexus Server, then open it again to receive the offer. Help and the setup instructions explain this sequence and that closing a browser window alone does not stop the services.

This launcher-first route is the implementation proposal, not a separately approved in-app update control. There is no new HTTP endpoint that installs software.

## Source and trust

Use only https://github.com/zook111/Nexus_BCI and its protected main branch. Show a short version identifier based on the Git commit; do not represent the backend's unchanged 0.1.0 package version as the installed app revision. Pin installation to the commit that was offered, not a subsequently moving main branch.

Use a noninteractive network check with an explicit timeout, no tokens and no new credentials. Do not run downloaded scripts directly from a URL. Fetch the pinned source through Git, validate the checkout and update only by fast-forward.

The main-branch choice relies on the existing enforced PR/check policy. Signed release manifests and a standalone signed/notarized DMG updater are separate work.

## Conditions before changing anything

- The checkout must be this public project, on main, with the expected remote. Refuse detached heads, other branches, divergence and local commits.
- Refuse tracked edits or unexpected untracked files. Do not stash, discard or merge a student's work. Ignored recordings, data, exports and local settings remain allowed.
- Refuse any update that would overwrite an ignored local file. Use Git's no-overwrite-ignore protection as well as checking the incoming tree for collisions with protected data/settings paths.
- Share the launcher's kernel lock for the whole install/start operation. Two launches must not install concurrently or start the app partway through an update.
- Require both local services stopped and the configured ports free. An unmanaged server or occupied port blocks installation; do not kill it.
- Check compatible existing Python/Node tools and sufficient disk space before moving source or dependencies. Do not install or upgrade system tools.

## Installation and recovery

The worker must survive replacing project files and dependencies. Run the current updater from a temporary stable copy using the base Python interpreter, rather than importing new project code halfway through installation.

Record the original commit and make recoverable backups of the existing Python environment and frontend dependencies before replacing them. Create new dependencies at their final checkout paths: Python virtual environments must not be built under a temporary prefix and then renamed, because entry-point paths would be wrong. Preserve executable modes and symlinks when backing up/restoring.

Use an atomic per-checkout journal outside the repository to record the pinned target, original revision, backup locations and phases. Existing unfinished transactions must be reconciled before another update or ordinary startup. Never report success with a partial source/dependency installation.

After a successful source/dependency update, start services under the same launcher lock and require the existing API/frontend readiness checks before reporting success. Close the check/restart cycle using the configured ports, including custom ports.

On an ordinary installation or startup failure, stop only this attempt's owned processes, restore the original code/dependencies and attempt to open the previous version. Rollback must preserve any unexpected user edits; if that cannot be established, leave the app stopped, retain backups and give a clear helper/recovery message. No hard reset, clean, automatic stash or deletion of participant files is permitted.

Interrupted updates must retain enough journal/backup information to recover safely on the next launch or explain exactly which helper action is needed. Do not guarantee unattended recovery from arbitrary disk failure. Retain one recovery generation after a healthy update; logs and journal stay local and must not contain credentials or participant data.

The existing macOS launcher may need one helper-led installation of this feature. Newly installed student launchers should include it through the normal setup route. Document this bootstrap step honestly: an old installation cannot gain updater code without first receiving this change.

## Verification before release

Use temporary repositories, fake remotes and isolated state directories. Test no update, declined update, offline launch, clean fast-forward, wrong remote, divergence, local edits, untracked/ignored collisions, concurrent launches and occupied ports. Preserve sentinel recordings and local settings through success, failure and recovery.

Inject failures at source checkout, dependency installation, partial service startup and interrupted journal phases. Confirm old Python entry points work after rollback and only owned processes are stopped. Test paths with spaces and quotes, configured ports and duplicate native launches.

Keep native compilation/signing/launcher checks on the Mac. Run relevant Python/frontend checks and CI. Use synthetic data only for record/save/reopen after a successful update. Independent Intel/Ventura verification remains required and is not replaced by ARM Mac or Linux CI tests.

Update the README, student starting page, relevant setup PDF/source and Help with the final student flow. Submit implementation through a reviewed PR, address all comments, and wait at least five minutes after the latest revision before merging.

## Confirmed behaviour

The user chose “Offer an Update and restart button”. The launcher-first offer implements that choice without an HTTP software-install endpoint. Updates are never silently installed. The app is stopped before an offer is accepted, so the button starts the updated app after installation.

Implementation decision: this first source updater requires checkout and local backup state on the same filesystem for atomic dependency moves. It refuses other layouts before mutation and points the helper to manual maintenance.
