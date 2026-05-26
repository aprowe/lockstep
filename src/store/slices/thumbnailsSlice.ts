import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { type HoverReason } from "../../api/thumbnailReason";

export interface ThumbnailsState {
    /** Resolved cache paths keyed by file hash then frame. */
    pathsByHashAndFrame: Record<string, Record<number, string>>;
    /** Component-dispatched hover state, one frame per hover reason per hash. */
    hoverByHash: Record<string, Partial<Record<HoverReason, number>>>;
}

const initialState: ThumbnailsState = {
    pathsByHashAndFrame: {},
    hoverByHash: {},
};

const slice = createSlice({
    name: "thumbnails",
    initialState,
    reducers: {
        setThumbnail(
            state,
            action: PayloadAction<{ fileHash: string; frame: number; path: string }>,
        ) {
            const { fileHash, frame, path } = action.payload;
            const bucket = state.pathsByHashAndFrame[fileHash] ?? {};
            bucket[frame] = path;
            state.pathsByHashAndFrame[fileHash] = bucket;
        },
        setHover(
            state,
            action: PayloadAction<{
                fileHash: string;
                reason: HoverReason;
                frame: number | null;
            }>,
        ) {
            const { fileHash, reason, frame } = action.payload;
            const bucket = state.hoverByHash[fileHash] ?? {};
            if (frame == null) delete bucket[reason];
            else bucket[reason] = frame;
            if (Object.keys(bucket).length === 0) delete state.hoverByHash[fileHash];
            else state.hoverByHash[fileHash] = bucket;
        },
        clearForHash(state, action: PayloadAction<string>) {
            delete state.pathsByHashAndFrame[action.payload];
            delete state.hoverByHash[action.payload];
        },
    },
});

export const { setThumbnail, setHover, clearForHash } = slice.actions;
export default slice.reducer;

export function selectThumbnailPath(fileHash: string | null | undefined, frame: number) {
    return (state: { thumbnails: ThumbnailsState }): string | undefined => {
        if (fileHash == null) return undefined;
        return state.thumbnails.pathsByHashAndFrame[fileHash]?.[frame];
    };
}
