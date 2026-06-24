#!/usr/bin/env node
import { createFileViewWsServer } from './server.js';

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

const port = parsePort(process.env.PORT, 8081);
const host = process.env.HOST ?? '0.0.0.0';

const server = createFileViewWsServer({ port, host });

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
