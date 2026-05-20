import { describe, it, expect } from "vitest";
import {
    anchorInId,
    anchorOutId,
    regionInId,
    regionOutId,
    parseEntityId,
    isAnchorIn,
    isAnchorOut,
    isClipIn,
    isClipOut,
} from "../../../src/constraints/ids";

describe("parseEntityId", () => {
    // ── Anchor parsing ─────────────────────────────────────────────────────────

    it("parses anchor-in IDs", () => {
        expect(parseEntityId("a0-in")).toEqual({ kind: "anchor-in", sourceId: "0" });
        expect(parseEntityId("a42-in")).toEqual({ kind: "anchor-in", sourceId: "42" });
        expect(parseEntityId("a999-in")).toEqual({ kind: "anchor-in", sourceId: "999" });
    });

    it("parses anchor-out IDs", () => {
        expect(parseEntityId("a0-out")).toEqual({ kind: "anchor-out", sourceId: "0" });
        expect(parseEntityId("a42-out")).toEqual({ kind: "anchor-out", sourceId: "42" });
        expect(parseEntityId("a999-out")).toEqual({ kind: "anchor-out", sourceId: "999" });
    });

    // ── Clip parsing ───────────────────────────────────────────────────────────

    it("parses clip-in IDs with a real region ID", () => {
        const id = regionInId("region_1700000000_0_abc");
        expect(parseEntityId(id)).toEqual({ kind: "clip-in", sourceId: "region_1700000000_0_abc" });
    });

    it("parses clip-out IDs with a real region ID", () => {
        const id = regionOutId("region_1700000000_0_abc");
        expect(parseEntityId(id)).toEqual({
            kind: "clip-out",
            sourceId: "region_1700000000_0_abc",
        });
    });

    // ── Edge cases ─────────────────────────────────────────────────────────────

    /**
     * A region whose ID itself ends in "-in" or "-out" could theoretically
     * collide with the anchor regex if it matched `a\d+`. Verify that such a
     * region ID is unambiguously classified as clip-* (it can't match `a\d+`).
     */
    it("is unambiguous when region ID ends in -in", () => {
        // regionId = "region_foo-in" → entity = "region_foo-in-in"
        const id = regionInId("region_foo-in");
        // ends in "-in" but doesn't match ^a\d+-in$, so it's clip-in
        expect(parseEntityId(id)).toEqual({ kind: "clip-in", sourceId: "region_foo-in" });
    });

    it("is unambiguous when region ID ends in -out", () => {
        // regionId = "region_foo-out" → entity = "region_foo-out-in"
        const id = regionInId("region_foo-out");
        expect(parseEntityId(id)).toEqual({ kind: "clip-in", sourceId: "region_foo-out" });
    });

    it("returns null for IDs without a recognised suffix", () => {
        expect(parseEntityId("a42")).toBeNull();
        expect(parseEntityId("region_abc")).toBeNull();
        expect(parseEntityId("")).toBeNull();
        expect(parseEntityId("something-else")).toBeNull();
    });

    // ── Round-trip ─────────────────────────────────────────────────────────────

    it("round-trips regionInId through parseEntityId", () => {
        const sourceId = "foo";
        const result = parseEntityId(regionInId(sourceId));
        expect(result).toEqual({ kind: "clip-in", sourceId });
    });

    it("round-trips regionOutId through parseEntityId", () => {
        const sourceId = "foo";
        const result = parseEntityId(regionOutId(sourceId));
        expect(result).toEqual({ kind: "clip-out", sourceId });
    });

    it("round-trips anchorInId through parseEntityId", () => {
        const result = parseEntityId(anchorInId(7));
        expect(result).toEqual({ kind: "anchor-in", sourceId: "7" });
    });

    it("round-trips anchorOutId through parseEntityId", () => {
        const result = parseEntityId(anchorOutId(7));
        expect(result).toEqual({ kind: "anchor-out", sourceId: "7" });
    });
});

describe("kind predicates", () => {
    it("isAnchorIn", () => {
        expect(isAnchorIn("a1-in")).toBe(true);
        expect(isAnchorIn("a1-out")).toBe(false);
        expect(isAnchorIn("region_abc-in")).toBe(false);
    });

    it("isAnchorOut", () => {
        expect(isAnchorOut("a1-out")).toBe(true);
        expect(isAnchorOut("a1-in")).toBe(false);
        expect(isAnchorOut("region_abc-out")).toBe(false);
    });

    it("isClipIn", () => {
        expect(isClipIn("region_abc-in")).toBe(true);
        expect(isClipIn("region_abc-out")).toBe(false);
        expect(isClipIn("a1-in")).toBe(false);
    });

    it("isClipOut", () => {
        expect(isClipOut("region_abc-out")).toBe(true);
        expect(isClipOut("region_abc-in")).toBe(false);
        expect(isClipOut("a1-out")).toBe(false);
    });
});
