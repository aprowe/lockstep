/**
 * Domain helpers over `Txn` (an array of `Write` records).
 *
 * The resolver and pipeline repeatedly search the in-flight transaction by
 * `(entityId, field)`. Spelling that out inline produces a lot of:
 *
 *   txn.find(w => w.entityId === id && w.field === field)
 *
 * These helpers cut the noise and give each access pattern a name.
 *
 * All helpers are pure and don't mutate the txn.
 */

import type { EntityId, Field, Txn, Write } from "./types";
import { Field as FieldEnum } from "./types";

/** Edge label ('in' / 'out') → `Field` enum. The two are equivalent at the
 *  type level (Field.In === 'in', Field.Out === 'out') but writing the
 *  ternary inline everywhere is noisy. */
export function edgeField(edge: "in" | "out"): Field {
    return edge === "in" ? FieldEnum.In : FieldEnum.Out;
}

/** Find the first write on `(entityId, field)` in `txn`. */
export function findWrite(txn: Txn, entityId: EntityId, field: Field): Write | undefined {
    return txn.find((w) => w.entityId === entityId && w.field === field);
}

/** Find the index of the first write on `(entityId, field)`. Returns -1 if
 *  not found (mirrors `Array.findIndex`). */
export function findWriteIndex(txn: Txn, entityId: EntityId, field: Field): number {
    return txn.findIndex((w) => w.entityId === entityId && w.field === field);
}

/** True iff a write exists for `(entityId, field)`. With `field` omitted,
 *  true iff ANY field of `entityId` has a write — useful for "did this
 *  entity move at all" checks. */
export function hasWrite(txn: Txn, entityId: EntityId, field?: Field): boolean {
    return txn.some((w) => w.entityId === entityId && (field === undefined || w.field === field));
}

/** Read the post-write value of `(entityId, field)` from the txn, falling
 *  back to `defaultValue` if no write exists. Useful when a handler wants
 *  "the value this field WILL have after the propose pass" without
 *  branching on the find result every time. */
export function txnValue(txn: Txn, entityId: EntityId, field: Field, defaultValue: number): number {
    const w = findWrite(txn, entityId, field);
    return w ? w.to : defaultValue;
}
