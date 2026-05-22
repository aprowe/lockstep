import { THUMB_SIZE_MAX, THUMB_SIZE_MIN } from "../../store/slices/listsSlice";
import "./ListThumbnailSizeSlider.css";

interface Props {
    /** Current thumbnail width in px. */
    size: number;
    onChange: (size: number) => void;
}

/** Compact range slider in the list-panel header for tuning thumbnail width.
 *  Only rendered when the panel's view mode is "list" or "grid". The
 *  reducer clamps to the allowed range, so no client-side validation here. */
export default function ListThumbnailSizeSlider({ size, onChange }: Props) {
    return (
        <input
            type="range"
            className="list-thumb-size"
            min={THUMB_SIZE_MIN}
            max={THUMB_SIZE_MAX}
            step={4}
            value={size}
            onChange={(e) => onChange(Number(e.target.value))}
            title={`Thumbnail size: ${size}px`}
            aria-label="Thumbnail size"
        />
    );
}
