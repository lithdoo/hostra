# hostra

`hostra` is an Electron local shell with a WebSocket JSON-RPC entrypoint for opening local web UI windows.

This repository uses a promptpile/dayloom-style monorepo layout:

- [`packages/hostra`](packages/hostra/) — npm package and CLI.
- [`examples/hostra-open-web`](examples/hostra-open-web/) — minimal `openWindow` example.
- [`examples/hostra-web-editor`](examples/hostra-web-editor/) — editor window example that expects the Lithdoo web editor components to be built.
- [`examples/hostra-file-view`](examples/hostra-file-view/) — file-view example that expects the Lithdoo file-view components to be built.
- [`examples/hostra-command-terminal`](examples/hostra-command-terminal/) — terminal example that expects the Lithdoo command components to be built.

Common commands:

```bash
npm install --ignore-scripts
npm test
npm run start -w hostra
```

The `hostra` package downloads Electron during its `postinstall` step. Use `npm install` without `--ignore-scripts` when you want to run the CLI locally.
