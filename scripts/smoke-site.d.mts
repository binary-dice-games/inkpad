// MIT License © 2026 Carlos Lopez
/** The problems found in a site; empty when it works. */
export function smokeSite(
  base: string,
  get?: (url: string) => Promise<Response>,
): Promise<string[]>;
