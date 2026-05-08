import { describe, expect, it } from "vite-plus/test";
import { Rope } from "./rope";

describe("Rope", () => {
  it("empty", () => {
    const r = Rope.empty();
    expect(r.length).toBe(0);
    expect(r.lineCount).toBe(1);
    expect(r.toString()).toBe("");
    expect(r.lineAt(0)).toBe("");
  });

  it("single line", () => {
    const r = Rope.fromString("hello world");
    expect(r.length).toBe(11);
    expect(r.lineCount).toBe(1);
    expect(r.toString()).toBe("hello world");
    expect(r.lineAt(0)).toBe("hello world");
  });

  it("multi line", () => {
    const r = Rope.fromString("a\nbb\nccc\n");
    expect(r.length).toBe(9);
    expect(r.lineCount).toBe(4);
    expect(r.lineAt(0)).toBe("a");
    expect(r.lineAt(1)).toBe("bb");
    expect(r.lineAt(2)).toBe("ccc");
    expect(r.lineAt(3)).toBe("");
  });

  it("slice", () => {
    const r = Rope.fromString("abcdefghij");
    expect(r.slice(0, 3)).toBe("abc");
    expect(r.slice(3, 7)).toBe("defg");
    expect(r.slice(7, 10)).toBe("hij");
  });

  it("replace insert", () => {
    const r = Rope.fromString("hello world");
    r.replace(5, 5, " brave");
    expect(r.toString()).toBe("hello brave world");
    expect(r.length).toBe(17);
  });

  it("replace delete", () => {
    const r = Rope.fromString("hello brave world");
    r.replace(5, 11, "");
    expect(r.toString()).toBe("hello world");
  });

  it("replace overwrite", () => {
    const r = Rope.fromString("hello world");
    r.replace(6, 11, "rope!");
    expect(r.toString()).toBe("hello rope!");
  });

  it("replace recomputes lines", () => {
    const r = Rope.fromString("a\nb\nc");
    expect(r.lineCount).toBe(3);
    r.replace(2, 2, "x\ny\n");
    expect(r.toString()).toBe("a\nx\ny\nb\nc");
    expect(r.lineCount).toBe(5);
  });

  it("hash stable, changes on edit", () => {
    const r = Rope.fromString("hello\nworld\n");
    const h1 = r.hash();
    expect(r.hash()).toBe(h1);
    r.replace(0, 5, "HELLO");
    const h2 = r.hash();
    expect(h2).not.toBe(h1);
  });

  it("large file chunking", () => {
    const line = "x".repeat(100) + "\n";
    const big = line.repeat(2000); // ~200KB, 2000 lines
    const r = Rope.fromString(big);
    expect(r.length).toBe(big.length);
    expect(r.lineCount).toBe(2001);
    expect(r.lineAt(0)).toBe("x".repeat(100));
    expect(r.lineAt(1999)).toBe("x".repeat(100));
    expect(r.lineAt(2000)).toBe("");
  });

  it("lineStartOffset", () => {
    const r = Rope.fromString("aa\nbbb\ncccc");
    expect(r.lineStartOffset(0)).toBe(0);
    expect(r.lineStartOffset(1)).toBe(3);
    expect(r.lineStartOffset(2)).toBe(7);
  });

  it("edit across chunk boundary", () => {
    const half = "x".repeat(40000) + "\n";
    const r = Rope.fromString(half + half + half); // ~120KB → 2+ chunks
    const before = r.lineCount;
    r.replace(40000, 40001, "Y\nZ\n"); // touches chunk boundary, adds 1 net newline
    expect(r.lineCount).toBe(before + 1);
  });
});
