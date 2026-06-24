/** Drain a few microtask rounds (FakeWebSocket uses `queueMicrotask`). */
export async function flushMicrotasks(rounds = 24): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}
