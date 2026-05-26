import { memo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useAppSelector } from "../store/hooks";
import { selectThumbnailPath } from "../store/slices/thumbnailsSlice";
import "./Thumbnail.css";

interface ThumbnailProps {
    fileHash: string | null | undefined;
    frame: number | null | undefined;
    /** Applied to whichever element actually renders (img *or* placeholder).
     *  Callers depend on this for sizing — without it a placeholder collapses
     *  to .thumbnail's 100%/100% and the row jumps when the img loads. */
    className?: string;
    /** Extra class for the placeholder only (e.g. distinct stripe pattern). */
    placeholderClassName?: string;
    alt?: string;
}

function cls(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(" ");
}

function ThumbnailImpl({
    fileHash,
    frame,
    className,
    placeholderClassName,
    alt = "",
}: ThumbnailProps) {
    const path = useAppSelector(
        fileHash != null && frame != null ? selectThumbnailPath(fileHash, frame) : () => undefined,
    );
    // A cached file can be evicted between the slice path being written and
    // the <img> resolving, leaving a stale src that would render as the
    // broken-image glyph. Latch the failed path so we swap to the errored
    // placeholder; a different path (re-extraction) automatically retries.
    const [failedPath, setFailedPath] = useState<string | null>(null);

    if (fileHash == null || frame == null) return null;
    const errored = path != null && path === failedPath;
    if (path == null || errored) {
        return (
            <div
                className={cls(
                    "thumbnail",
                    "thumbnail--placeholder",
                    errored && "thumbnail--errored",
                    className,
                    placeholderClassName,
                )}
                title={errored ? "Thumbnail file missing" : undefined}
            />
        );
    }
    return (
        <img
            className={cls("thumbnail", className)}
            src={convertFileSrc(path)}
            alt={alt}
            draggable={false}
            onError={() => setFailedPath(path)}
        />
    );
}

export default memo(ThumbnailImpl);
