# Standalone macOS DMG assessment

Inspected 19 October 2026. This is a packaging plan, not a built or released installer.

## Recommendation

A drag-to-Applications DMG is a useful next distribution step for the student team. Package a standalone app with the Python backend, BrainFlow/native numerical dependencies, and the built React assets. Keep the current source-install guide for the next hardware session until that bundle passes an independent Intel/Ventura test.

Do not distribute a DMG containing only the current Nexus Server launcher. It embeds an absolute checkout path and requires that checkout's `.venv`, Node and Vite `node_modules`. Copying that launcher to another Mac would not install the application.

## Evidence inspected

- `script/install_desktop_launcher.sh` compiles a source-checkout launcher and applies ad-hoc signing.
- `script/build_and_run.sh` starts the checkout's Python/Uvicorn and Node/Vite processes. The API does not currently serve `frontend/dist`.
- The installed desktop bundle passes `codesign --verify --strict`, but its signature is ad-hoc, with no TeamIdentifier or CFBundleIdentifier. Signature validity here is not public-distribution trust.
- This Mac and project Python environment are ARM. PyInstaller is not installed in the project environment. No Developer ID Application identity was found in the current signing keychain. The existing launcher executable is universal, but that does not make its external Python dependencies universal.

## Proposed bundle and lifecycle

1. Build the production React assets and include them with a frozen Python backend, using an explicit dependency manifest for BrainFlow, NumPy, SciPy, pyRiemann and scikit-learn native components.
2. Serve those assets from the local API after the existing API/WebSocket routes. Preserve loopback binding and allow only the actual same-origin browser URL in the origin policy. Do not widen the service to the LAN.
3. Add a small app launcher with a stable bundle identifier, start/stop status and error reporting. Open the browser only after health checks pass. Fail clearly on occupied ports without killing another application's process.
4. Store recordings, experiment annotations, demo data and logs under the current user's Application Support folder. Never write into the signed app bundle or mounted DMG. Preserve data across app upgrades and shutdown.
5. Build separate x86_64 and ARM artifacts first. Use universal2 only after every native dependency is verified for both architectures. Build the Intel package in a verified x86_64 environment or a complete compatible multi-architecture environment; the current ARM virtual environment is insufficient.
6. Sign nested native code and the app with Developer ID Application and the required hardened-runtime settings. Create the DMG, notarize through Apple's supported workflow, and staple/validate the resulting ticket. Do not disable Gatekeeper or strip quarantine as an installation step.

## Acceptance checks before handing it to students

- Fresh Intel Ventura 13.7.8 account, with no Python, Node, Git or source checkout required for normal launch.
- Downloaded/quarantined DMG opens through normal Gatekeeper controls; app works after dragging into Applications and ejecting the DMG.
- Paths with spaces, occupied ports, duplicate launches, shutdown, relaunch and upgrades preserve correct process ownership and recordings.
- Bundled PDFs, audio assets, Web Audio pad, local API/WebSocket and synthetic record/save/replay work without cloud keys.
- Native BrainFlow libraries load with the expected Intel architecture. The real headset then gets its own contact-quality and acquisition test; installation success does not establish usable EEG.
- Participant files and credentials are absent from the signed artifact. Raw/label/report data remains in the user's private storage.

## Actual prerequisites for a distributable Intel installer

The remaining human-controlled items are access to a verified Intel build/test environment and the appropriate Apple Developer ID/notarization setup. No signing identity was created, no account setting changed, no software uploaded to Apple, and no DMG published in this assessment. A local unsigned prototype would still need those distribution and intended-machine checks.

Sources inspected: [Apple packaging](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution), [Developer ID](https://developer.apple.com/developer-id/), [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), and [PyInstaller macOS architecture support](https://pyinstaller.org/en/stable/feature-notes.html#macos-multi-arch-support).
