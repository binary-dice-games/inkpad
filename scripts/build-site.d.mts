// MIT License © 2026 Binary Dice Games
export function protocolMajor(): number;
export function normalizeBase(base: string): string;
export function buildSite(
  out: string,
  options?: { base?: string; archive?: string },
): Promise<{ versionDir: string }>;
