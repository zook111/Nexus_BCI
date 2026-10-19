# Nexus EEG Lab identity

Nexus is a local EEG instrument and learning workspace, designed for students and researchers.

**Design read:** overhaul the visual identity of an operational console for students and researchers viewing a laptop at normal working distance. The work panels remain dense and quiet; a contrasting instrument header gives the product a clear identity.

- Visual variance **4/10**: stable three-column acquisition console; distinct instrument framing.
- Motion **2/10**: control feedback only; reduced-motion support. Existing live visualizers retain their signal-driven behavior.
- Density **8/10**: acquisition, waveform and quality information remain visible together.
- Asset dependence **3/10**: original logo and real synthetic-board screenshots; waveforms carry the interface.
- Existing brand fidelity **2/10**: Nexus replaces the former identity. Functional contracts remain intact.

The original N/signal logo is [nexus-symbol.svg](../frontend/public/nexus-symbol.svg); the favicon retains that project mark. The [macOS launcher icon](../assets/macos/eeg-lab-icon.png) uses a mint neural-loop/EEG glyph on a dimensional ink-blue tile for Nexus EEG Lab. The 1024-pixel PNG has transparent margins and is converted into the full native ICNS size set during launcher installation. Product screenshots in `docs/images/` show the actual application with synthetic signals only.

Ink-blue chrome `#142c39`, white work panels, pale slate `#eef2f3`, and restrained teal `#087c76` define the interface. Quality indicators retain separate good/check/bad meanings. Typography uses locally available Avenir Next with Segoe UI and native fallbacks, plus a monospace face for machine state; no external font request is required. Spacing follows a 4 px rhythm, with 6–10 px radii and shallow panel shadows.

Preserve navigation, API routes, storage layout, recording controls, quality thresholds, audio gates, keyboard focus, and lesson maths. Improve hierarchy, grouping, responsive navigation and contrast. Remove the animated wordmark glow and personal lab branding. Hardware auto-connect now requires an explicit local serial opt-in instead of a personal hardcoded dongle.
