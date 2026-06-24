#!/usr/bin/env node
import { createLspWsServer } from './server.js';

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const port = parsePort(process.env.PORT, 8080);
const host = process.env.HOST ?? '0.0.0.0';

const server = createLspWsServer({ port, host });

await server.listen();

const shutdown = async () => {
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
