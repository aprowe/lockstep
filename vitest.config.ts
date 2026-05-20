import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: "happy-dom",
        include: ["tests/**/*.test.{ts,tsx}"],
        // Quarantined: tests removed when dragCtxSlice was dissolved (Task 13).
        // Kept in tree under tests/_legacy-removed-task13/ for review; excluded
        // from runs because they import deleted slices/middlewares.
        exclude: [
            "**/node_modules/**",
            "tests/_legacy-removed-task13/**",
            "tests/_legacy-removed-conform-restructure/**",
        ],
    },
});
