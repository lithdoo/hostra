/**
 * Test-only resolve hook for `node --import tsx --import ./test/register-css-loader.mjs`:
 * - `*.css` / `*.css?raw` → empty default export (Vite `?raw` in source).
 * - `xterm` / addons → minimal ESM stubs (real packages are CJS; named imports fail under Node tests).
 */
function dataEsModule(source) {
  return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source);
}

const XTERM_TERMINAL_STUB = `
export class Terminal {
  constructor() {}
  loadAddon() {}
  open() {}
  dispose() {}
}
`;

const XTERM_FIT_STUB = `
export class FitAddon {
  activate() {}
  dispose() {}
  fit() {}
}
`;

const XTERM_ATTACH_STUB = `
export class AttachAddon {
  constructor() {}
  activate() {}
  dispose() {}
}
`;

function isMainXtermLib(url) {
  return /[/\\]node_modules[/\\]xterm[/\\]lib[/\\]xterm\.js$/i.test(url);
}

function isXtermFitLib(url) {
  return /[/\\]node_modules[/\\]xterm-addon-fit[/\\]lib[/\\]xterm-addon-fit\.js$/i.test(
    url,
  );
}

function isXtermAttachLib(url) {
  return /[/\\]node_modules[/\\]xterm-addon-attach[/\\]lib[/\\]xterm-addon-attach\.js$/i.test(
    url,
  );
}

export async function resolve(specifier, context, nextResolve) {
  const raw = String(specifier);
  if (/\.css(\?|$)/.test(raw)) {
    return {
      shortCircuit: true,
      url: dataEsModule('export default "";'),
    };
  }

  const result = await nextResolve(specifier, context);
  const url = result.url;
  if (!url || !url.startsWith('file:')) {
    return result;
  }

  if (isMainXtermLib(url)) {
    return { shortCircuit: true, url: dataEsModule(XTERM_TERMINAL_STUB) };
  }
  if (isXtermFitLib(url)) {
    return { shortCircuit: true, url: dataEsModule(XTERM_FIT_STUB) };
  }
  if (isXtermAttachLib(url)) {
    return { shortCircuit: true, url: dataEsModule(XTERM_ATTACH_STUB) };
  }
  return result;
}
