/**
 * Push a value onto the bucket for `key` in a `Map<K, V[]>`, creating the
 * bucket on first insert. Pulled out because the resolver, the
 * `derived-index` bundle builder, and the pipeline's conform-rule
 * construction all do exactly the same get-or-create-then-push pattern.
 *
 * Returns nothing — `map` is mutated in place.
 */
export function pushToBucket<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const bucket = map.get(key);
    if (bucket) {
        bucket.push(value);
        return;
    }
    map.set(key, [value]);
}
