// Maps bufferId → Rope. Held outside Zustand/immer state because rope chunks
// are mutable arrays and immer would deep-clone them on every edit, defeating
// the chunked-storage win.
//
// Buffer-store calls registerRope on create, updateRope on content change,
// dropRope on close. Consumers (editor render, tokenizer, text-operations)
// read via getRope. If a buffer hasn't been registered yet (legacy code path,
// virtual buffers, etc.), getRope returns null — callers fall back to string
// operations on `.content`.

import { Rope } from "./rope";

const registry = new Map<string, Rope>();

export function registerRope(bufferId: string, content: string): Rope {
  const rope = Rope.fromString(content);
  registry.set(bufferId, rope);
  return rope;
}

export function updateRope(bufferId: string, content: string): Rope {
  const rope = Rope.fromString(content);
  registry.set(bufferId, rope);
  return rope;
}

// Apply an in-place edit to the rope without re-chunking the whole content.
// Caller guarantees [start, end) is in the current rope's char range.
export function spliceRope(
  bufferId: string,
  start: number,
  end: number,
  text: string,
): Rope | null {
  const rope = registry.get(bufferId);
  if (!rope) return null;
  rope.replace(start, end, text);
  return rope;
}

export function getRope(bufferId: string): Rope | null {
  return registry.get(bufferId) ?? null;
}

export function dropRope(bufferId: string): void {
  registry.delete(bufferId);
}

export function clearRopeRegistry(): void {
  registry.clear();
}
