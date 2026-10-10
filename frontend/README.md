# Nexus UI

React/Vite frontend for the local Nexus EEG workspace.

Use the [root README](../README.md) for installation and the first synthetic stream. With a supported Node version (Node 24 recommended):

```bash
npm ci
npm run dev -- --host 127.0.0.1
```

The API defaults to `http://localhost:8000`. Set `VITE_API_BASE_URL` in a local environment file for another API URL. Frontend environment variables are public build configuration; never put API keys in them.

Hardware connection is manual by default. Set both `VITE_OPENBCI_AUTOCONNECT_SERIAL` and `VITE_OPENBCI_AUTOCONNECT_BOARD` to enable startup connection for exactly one matching, recommended USB dongle. The board must be `cyton` or `cyton_daisy`; a serial number cannot identify a board definition. An active board session locks device selection until Reset. DSP and quality default to 50 Hz mains filtering; adjust for your region.

```bash
npm run lint
npm test -- --run
npm run build
```
