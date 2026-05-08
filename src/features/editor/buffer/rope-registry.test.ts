import { describe, expect, it, beforeEach } from "vite-plus/test";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import {
  clearRopeRegistry,
  dropRope,
  getRope,
  registerRope,
  spliceRope,
  updateRope,
} from "./rope-registry";

const big = "x".repeat(EDITOR_CONSTANTS.ROPE_BACKING_MIN_BYTES + 100);
const small = "small content";

describe("rope-registry", () => {
  beforeEach(() => clearRopeRegistry());

  it("skips rope under threshold", () => {
    expect(registerRope("a", small)).toBeNull();
    expect(getRope("a")).toBeNull();
  });

  it("registers rope at/above threshold", () => {
    const r = registerRope("b", big);
    expect(r).not.toBeNull();
    expect(getRope("b")).toBe(r);
    expect(r!.length).toBe(big.length);
  });

  it("update replaces rope", () => {
    registerRope("c", big);
    const r2 = updateRope("c", big + "Y");
    expect(r2).not.toBeNull();
    expect(getRope("c")?.length).toBe(big.length + 1);
  });

  it("update under threshold drops rope", () => {
    registerRope("d", big);
    const r = updateRope("d", small);
    expect(r).toBeNull();
    expect(getRope("d")).toBeNull();
  });

  it("drop removes rope", () => {
    registerRope("e", big);
    dropRope("e");
    expect(getRope("e")).toBeNull();
  });

  it("splice mutates in place", () => {
    registerRope("f", big);
    const r = spliceRope("f", 0, 1, "Z");
    expect(r).not.toBeNull();
    expect(getRope("f")?.slice(0, 1)).toBe("Z");
  });

  it("splice returns null for unregistered", () => {
    expect(spliceRope("ghost", 0, 1, "X")).toBeNull();
  });
});
