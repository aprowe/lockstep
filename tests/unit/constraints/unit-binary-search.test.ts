import { describe, expect, it } from "vitest";
import { lowerBoundBy, lowerBoundNumber } from "../../../src/constraints/binary-search";

describe("lowerBoundNumber", () => {
    it("returns 0 on empty input", () => {
        expect(lowerBoundNumber([], 5)).toBe(0);
        expect(lowerBoundNumber(new Float64Array([]), 5)).toBe(0);
    });

    it("returns arr.length when target is above every element", () => {
        expect(lowerBoundNumber([1, 2, 3, 4, 5], 10)).toBe(5);
    });

    it("returns 0 when target is at or below every element", () => {
        expect(lowerBoundNumber([1, 2, 3], 0)).toBe(0);
        expect(lowerBoundNumber([1, 2, 3], 1)).toBe(0);
    });

    it("returns the leftmost index with arr[i] >= target", () => {
        expect(lowerBoundNumber([1, 3, 5, 7, 9], 4)).toBe(2);
        expect(lowerBoundNumber([1, 3, 5, 7, 9], 5)).toBe(2);
        expect(lowerBoundNumber([1, 3, 5, 7, 9], 6)).toBe(3);
    });

    it("returns the first occurrence on duplicate runs", () => {
        // ['lower bound' = "first index >= target"; duplicates of the target
        // all qualify, we want the leftmost so a forward walk hits all of them.]
        expect(lowerBoundNumber([1, 2, 2, 2, 3], 2)).toBe(1);
    });

    it("works on Float64Array with fractional values", () => {
        const arr = new Float64Array([0.1, 0.5, 1.25, 3.5, 7.0]);
        expect(lowerBoundNumber(arr, 0.5)).toBe(1);
        expect(lowerBoundNumber(arr, 0.6)).toBe(2);
        expect(lowerBoundNumber(arr, 7.0)).toBe(4);
        expect(lowerBoundNumber(arr, 7.000001)).toBe(5);
    });

    it("brackets a range correctly", () => {
        // The canonical use: forward-walk from `start` until exceeding the
        // upper bound is the snap-radius window in evaluateSnap.
        const arr = [10, 20, 30, 40, 50, 60, 70];
        const start = lowerBoundNumber(arr, 25);
        const collected: number[] = [];
        for (let i = start; i < arr.length && arr[i] <= 55; i++) collected.push(arr[i]);
        expect(collected).toEqual([30, 40, 50]);
    });
});

describe("lowerBoundBy", () => {
    interface Marker {
        id: string;
        time: number;
    }
    const markers: Marker[] = [
        { id: "a", time: 1 },
        { id: "b", time: 3 },
        { id: "c", time: 5 },
        { id: "d", time: 9 },
    ];

    it("returns 0 on empty input", () => {
        expect(lowerBoundBy<Marker>([], 5, (m) => m.time)).toBe(0);
    });

    it("delegates to the accessor for comparison", () => {
        expect(lowerBoundBy(markers, 5, (m) => m.time)).toBe(2);
        expect(lowerBoundBy(markers, 6, (m) => m.time)).toBe(3);
    });

    it("returns arr.length when target exceeds every value", () => {
        expect(lowerBoundBy(markers, 100, (m) => m.time)).toBe(4);
    });

    it("returns 0 when target is at or below the smallest value", () => {
        expect(lowerBoundBy(markers, -5, (m) => m.time)).toBe(0);
        expect(lowerBoundBy(markers, 1, (m) => m.time)).toBe(0);
    });
});
