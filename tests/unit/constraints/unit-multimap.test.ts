import { describe, expect, it } from "vitest";
import { pushToBucket } from "../../../src/constraints/multimap";

describe("pushToBucket", () => {
    it("creates a bucket on first insert", () => {
        const m = new Map<string, number[]>();
        pushToBucket(m, "a", 1);
        expect(m.get("a")).toEqual([1]);
    });

    it("appends to an existing bucket", () => {
        const m = new Map<string, number[]>();
        pushToBucket(m, "a", 1);
        pushToBucket(m, "a", 2);
        pushToBucket(m, "a", 3);
        expect(m.get("a")).toEqual([1, 2, 3]);
    });

    it("keeps independent buckets per key", () => {
        const m = new Map<string, string[]>();
        pushToBucket(m, "x", "alpha");
        pushToBucket(m, "y", "beta");
        pushToBucket(m, "x", "gamma");
        expect(m.get("x")).toEqual(["alpha", "gamma"]);
        expect(m.get("y")).toEqual(["beta"]);
    });

    it("preserves insertion order and reference identity of buckets", () => {
        const m = new Map<string, number[]>();
        pushToBucket(m, "a", 1);
        const bucketRef = m.get("a");
        pushToBucket(m, "a", 2);
        expect(m.get("a")).toBe(bucketRef);
    });
});
