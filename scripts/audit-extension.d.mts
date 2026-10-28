// MIT License © 2026 Carlos Lopez
export const ALLOWED_PERMISSIONS: Record<string, string>;
/** The problems found in a built extension; empty when it passes. */
export function auditExtension(dir: string, options?: { version?: string }): string[];
