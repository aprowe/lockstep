import { useEffect, useRef, useState } from "react";
import type { Region } from "../../types";
import type { RowContext } from "../../components/list/ListPanel";
import RowShell from "../../components/list/RowShell";
import { formatTime } from "../../utils/time";
import "./ClipRow.css";

interface Props {
    region: Region;
    ctx: RowContext;
    pendingRename: boolean;
    onCommitRename: (id: string, name: string) => void;
    onCancelRename: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onDoubleClick: () => void;
    /** Per-row delete affordance — removes just this region without touching
     *  the rest of the multi-selection. */
    onDelete: () => void;
}

export default function ClipRow({
    region,
    ctx,
    pendingRename,
    onCommitRename,
    onCancelRename,
    onContextMenu,
    onDoubleClick,
    onDelete,
}: Props) {
    const [renameValue, setRenameValue] = useState(region.name);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (pendingRename) {
            setRenameValue(region.name);
            // Defer select() so React has committed the input mount.
            setTimeout(() => inputRef.current?.select(), 20);
        }
    }, [pendingRename, region.name]);

    const commit = () => {
        if (renameValue.trim()) onCommitRename(region.id, renameValue.trim());
        else onCancelRename();
    };

    const colorIndex = region.colorIndex ?? 0;

    return (
        <RowShell
            kind="clip-row"
            ctx={ctx}
            deleteLabel="Delete clip"
            onDelete={onDelete}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
        >
            <span className={`clip-row__swatch clip-overlay--color-${colorIndex % 8}`} />
            <div className="clip-row__body">
                {pendingRename ? (
                    <input
                        ref={inputRef}
                        className="clip-row__rename"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") commit();
                            if (e.key === "Escape") onCancelRename();
                            e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                    />
                ) : (
                    <div className="clip-row__name" title={region.name}>
                        {region.name}
                    </div>
                )}
                <div className="clip-row__range">
                    {formatTime(region.inPoint)} – {formatTime(region.outPoint)}
                </div>
            </div>
        </RowShell>
    );
}
