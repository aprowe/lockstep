import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import thumbnailsReducer, { setThumbnail } from "../../../src/store/slices/thumbnailsSlice";
import Thumbnail from "../../../src/components/Thumbnail";

vi.mock("@tauri-apps/api/core", () => ({
    convertFileSrc: (p: string) => `tauri://localhost/${p}`,
}));

function makeStore() {
    return configureStore({ reducer: { thumbnails: thumbnailsReducer } });
}

describe("<Thumbnail />", () => {
    it("renders a placeholder when no path", () => {
        const store = makeStore();
        const { container } = render(
            <Provider store={store}>
                <Thumbnail fileHash="h" frame={0} />
            </Provider>,
        );
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector(".thumbnail--placeholder")).not.toBeNull();
    });

    it("renders an <img> with convertFileSrc when path is present", () => {
        const store = makeStore();
        store.dispatch(setThumbnail({ fileHash: "h", frame: 5, path: "/x.jpg" }));
        const { container } = render(
            <Provider store={store}>
                <Thumbnail fileHash="h" frame={5} />
            </Provider>,
        );
        const img = container.querySelector("img");
        expect(img).not.toBeNull();
        expect(img!.getAttribute("src")).toBe("tauri://localhost//x.jpg");
    });

    it("renders nothing when frame is null", () => {
        const store = makeStore();
        const { container } = render(
            <Provider store={store}>
                <Thumbnail fileHash="h" frame={null} />
            </Provider>,
        );
        expect(container.firstChild).toBeNull();
    });
});
