// MIT License © 2026 Binary Dice Games

/**
 * Resolves when `condition` is truthy, polling every 5 ms.
 * @throws {Error} if it does not become true within `timeoutMs`
 */
export async function until(
  condition: () => unknown,
  what = 'condition',
  timeoutMs = 5000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Lets queued microtasks and 0 ms timers run (for "nothing happens" checks). */
export async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
