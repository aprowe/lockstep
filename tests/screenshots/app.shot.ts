import { test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockTauri } from "./tauri-mock";
import { seed } from "./state";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "..", "..", "docs", "screenshots");

const SAMPLE_DURATION = 32;
const SAMPLE_BPM = 120;

// Roughly bar-spaced markers across a 32s sample @ 120 BPM (bar = 2s).
const SAMPLE_ANCHORS: Array<[number, number]> = [
    [2.1, 2.0],
    [5.85, 6.0],
    [9.7, 10.0],
    [13.4, 14.0],
    [17.6, 18.0],
    [22.1, 22.0],
    [26.7, 26.0],
];

const SAMPLE_REGIONS = [
    { name: "Intro", inPoint: 0, outPoint: 8 },
    { name: "Verse", inPoint: 8, outPoint: 20 },
    { name: "Drop", inPoint: 20, outPoint: 32 },
];

test.describe("Lockstep guide screenshots", () => {
    test.beforeEach(async ({ page }) => {
        await mockTauri(page);
    });

    // ── 01 — empty / overview chrome ─────────────────────────────────────────
    // Replaces the placeholder for the "interface tour" section with a
    // populated overview shot once we seed video + markers + regions.
    test("01-overview", async ({ page }) => {
        await page.goto("/");
        await seed(page, {
            video: { duration: SAMPLE_DURATION, name: "beach-jump.mp4" },
            bpm: SAMPLE_BPM,
            anchors: SAMPLE_ANCHORS,
            regions: SAMPLE_REGIONS,
            view: { start: 0, end: SAMPLE_DURATION },
            activeRegion: "Verse",
        });
        await settle(page);
        await page.screenshot({
            path: path.join(OUT_DIR, "01-overview.png"),
            fullPage: false,
        });
    });

    // ── 03 — BPM panel close-up ──────────────────────────────────────────────
    test("03-bpm-panel", async ({ page }) => {
        await page.goto("/");
        await seed(page, {
            video: { duration: SAMPLE_DURATION },
            bpm: SAMPLE_BPM,
            anchors: SAMPLE_ANCHORS,
            regions: SAMPLE_REGIONS,
            view: { start: 0, end: SAMPLE_DURATION },
            activeRegion: "Verse",
        });
        await settle(page);
        // RegionInfoPanel root class is .rip — captures IN/OUT/DUR/BPM/BEATS controls.
        const panel = page.locator(".rip").first();
        await panel.scrollIntoViewIfNeeded();
        await panel.screenshot({ path: path.join(OUT_DIR, "03-bpm-panel.png") });
    });

    // ── 04 — markers on the timeline ─────────────────────────────────────────
    test("04-markers-on-timeline", async ({ page }) => {
        await page.goto("/");
        await seed(page, {
            video: { duration: SAMPLE_DURATION },
            bpm: SAMPLE_BPM,
            anchors: SAMPLE_ANCHORS.map(([o]) => [o, o] as [number, number]), // all linked
            view: { start: 0, end: SAMPLE_DURATION },
        });
        await settle(page);
        await page.screenshot({
            path: path.join(OUT_DIR, "04-markers-on-timeline.png"),
            clip: { x: 240, y: 480, width: 900, height: 380 },
        });
    });

    // ── 05 — beat-side handle aligned to grid ────────────────────────────────
    // Static shot of post-alignment state (mid-drag is impractical to fake).
    test("05-align-handle", async ({ page }) => {
        await page.goto("/");
        await seed(page, {
            video: { duration: SAMPLE_DURATION },
            bpm: SAMPLE_BPM,
            anchors: SAMPLE_ANCHORS, // mismatched orig vs beat → connector is slanted
            view: { start: 0, end: SAMPLE_DURATION },
        });
        await settle(page);
        await page.screenshot({
            path: path.join(OUT_DIR, "05-align-handle.png"),
            clip: { x: 240, y: 480, width: 900, height: 380 },
        });
    });

    // ── 06 — regions overlaid on the timeline ────────────────────────────────
    test("06-regions", async ({ page }) => {
        await page.goto("/");
        await seed(page, {
            video: { duration: SAMPLE_DURATION },
            bpm: SAMPLE_BPM,
            anchors: SAMPLE_ANCHORS,
            regions: SAMPLE_REGIONS,
            view: { start: 0, end: SAMPLE_DURATION },
            activeRegion: "Verse",
        });
        await settle(page);
        await page.screenshot({
            path: path.join(OUT_DIR, "06-regions.png"),
            fullPage: false,
        });
    });

    // ── 07 — export dialog open ──────────────────────────────────────────────
    test("07-export-dialog", async ({ page }) => {
        await page.goto("/");
        await seed(page, {
            video: { duration: SAMPLE_DURATION },
            bpm: SAMPLE_BPM,
            anchors: SAMPLE_ANCHORS,
            regions: SAMPLE_REGIONS,
            view: { start: 0, end: SAMPLE_DURATION },
            exportOpen: true,
        });
        await settle(page);
        await page.screenshot({
            path: path.join(OUT_DIR, "07-export-dialog.png"),
            fullPage: false,
        });
    });

    // ── 09 — keyboard shortcuts cheat sheet ─────────────────────────────────
    test("09-hotkey-sheet", async ({ page }) => {
        await page.goto("/");
        await page.waitForFunction(() =>
            Boolean((window as unknown as { __STORE__?: unknown }).__STORE__),
        );
        await page.evaluate(() => {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
        });
        await settle(page);
        await page.screenshot({
            path: path.join(OUT_DIR, "09-hotkey-sheet.png"),
            fullPage: false,
        });
    });

    // 02 (drag overlay) and 08 (file manager view) are intentionally absent —
    // they need OS-level capture (real drag, real Explorer/Finder). Use a tool
    // like Snipping Tool / screencapture and save into docs/screenshots/.
});

async function settle(page: import("@playwright/test").Page) {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
}
