import { describe, it, expect } from "vitest";
import reducer, {
    setThumbnail,
    setHover,
    clearForHash,
    selectThumbnailPath,
} from "../../../src/store/slices/thumbnailsSlice";
import { ThumbnailReason } from "../../../src/api/thumbnailReason";

const initial = reducer(undefined, { type: "@@INIT" });

describe("thumbnailsSlice", () => {
    it("setThumbnail writes a path under (hash, frame)", () => {
        const s = reducer(initial, setThumbnail({ fileHash: "h", frame: 42, path: "/p" }));
        expect(s.pathsByHashAndFrame.h[42]).toBe("/p");
    });

    it("setHover stores frame; passing null clears", () => {
        const s1 = reducer(
            initial,
            setHover({ fileHash: "h", reason: ThumbnailReason.ClipHover, frame: 7 }),
        );
        expect(s1.hoverByHash.h?.[ThumbnailReason.ClipHover]).toBe(7);
        const s2 = reducer(
            s1,
            setHover({ fileHash: "h", reason: ThumbnailReason.ClipHover, frame: null }),
        );
        expect(s2.hoverByHash.h?.[ThumbnailReason.ClipHover]).toBeUndefined();
    });

    it("clearForHash drops paths and hover for that hash only", () => {
        let s = reducer(initial, setThumbnail({ fileHash: "a", frame: 1, path: "/x" }));
        s = reducer(s, setThumbnail({ fileHash: "b", frame: 2, path: "/y" }));
        s = reducer(s, setHover({ fileHash: "a", reason: ThumbnailReason.SceneHover, frame: 1 }));
        s = reducer(s, clearForHash("a"));
        expect(s.pathsByHashAndFrame.a).toBeUndefined();
        expect(s.hoverByHash.a).toBeUndefined();
        expect(s.pathsByHashAndFrame.b[2]).toBe("/y");
    });

    it("selectThumbnailPath returns undefined when missing", () => {
        const root = { thumbnails: initial };
        expect(selectThumbnailPath("h", 0)(root)).toBeUndefined();
    });
});
