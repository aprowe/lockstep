# Rebase plan — main branch

**Goal:** Squash main from **47 commits → 19 commits** without losing the narrative shape of the work. Foundation commits (already well-organized) stay as-is; the post-foundation evolution gets compressed into thematic squashes.

**Safety:** Before starting, tag the current tip (`git branch archive/pre-squash-backup-3 main`). One commit pair below is dropped entirely because it is a net no-op revert.

---

## Drop these (net no-op)

| SHA       | Subject                                                            | Why drop                                    |
| --------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `f1b8530` | feat(constraints): memoized release for diverged-clipout conform   | Reverted by `b380ba5`. Drop both.           |
| `b380ba5` | Revert "feat(constraints): memoized release for diverged-clipout…" | The revert itself. Drop along with f1b8530. |

`2af41b2` (lock follows clipout writes) lives between them but is an independent fix touching different code — keep it.

---

## Final 19 commits (oldest → newest)

### Foundation (May 18 — keep verbatim, already well-organized)

| #   | New commit                                                    | Squash from |
| --- | ------------------------------------------------------------- | ----------- |
| 1   | Initial project scaffolding: build, tooling, and CI           | `c0441f7`   |
| 2   | Rust backend: video pipeline, warp, diagnostics, storage      | `3eab24a`   |
| 3   | Frontend foundation: store, API, utilities, theming           | `334c138`   |
| 4   | Constraint system + timeline model layer                      | `a003503`   |
| 5   | UI: components, layout, canvas timeline + controller          | `f3ef36b`   |
| 6   | Tests + BDD spec system                                       | `1d6c40b`   |
| 7   | Docs: visual + interaction design, icon language, screenshots | `f7d4b82`   |

### Post-foundation (squashes)

#### 8. `refactor(pipeline): remove dead code + post-processing fields, inject boundary anchors`

Squash: `1f61a39` + `9741156`

```
refactor(pipeline): remove dead code + post-processing fields, inject boundary anchors

Strip unused warp surface area and centralize clip-window encoding on the
time map.

- Delete diagnostic.rs / api/diagnostic.ts (startDiagnostic never wired).
- Remove trigger_mode, fade_at_loop, pad_dur, interpolate_video, and the
  dead rearrange_loop branch from WarpOptions / WarpRequest / Region / CLI.
- Delete post.rs and the beat_zero_time / add_to_end / trim_to_loop /
  loop_beats post-processing fields. WarpOptions now starts at clip_in
  after BPM.
- Inject synthetic boundary anchors from Region.inBeatTime / outBeatTime
  so the time map always encodes the intended BPM stretch even when no
  real markers sit inside the clip window. Real anchors at the boundary
  positions are replaced by constraint-system values; identity case is
  inBeatTime == inPoint && outBeatTime == outPoint.
- Frontend: selectWarpData / WarpData / HistoryEntry /
  SavedVideoState.defaultRegion / Region fixtures lose the removed fields.
  buildWarpRequest + ExportDialog are rewritten around
  ExportJobInput.inBeatTime / outBeatTime.

Tests: 4 time_map unit tests (<1 µs tolerance) + 4 heavy e2e tests
(±100 ms ffmpeg tolerance) covering identity, no-markers clip warp,
markers full clip, and markers + clip warp.
```

#### 9. `feat(storage): sidecar-only project state + recent files menu`

Squash: `e00df17` + `b4b002a` + `edb77a2`

```
feat(storage): sidecar-only project state + recent files menu

Replace hash-keyed app-data storage with a single sidecar JSON living next
to the video, and add an Open Recent submenu.

- Sidecar path uses full filename (video.mp4 → video.mp4.json) so
  video.mp4 and video.mkv don't collide in the same directory.
- videoPath (relative filename) is embedded in the sidecar so a JSON
  moved elsewhere can still resolve its video.
- find_video_for_json() checks embedded videoPath before stem-matching,
  used by open_json_file and read_json_sidecar_for_video.
- persistenceMiddleware and loadMarkersForVideo are sidecar-only (no
  hash fallback). Old storage.rs commands and markers/ directory deleted.
- Folder badge counts now use checkVideoSidecar (instead of getFileHash
  + loadVideoState).
- Recent files: 10-item list in app data (recent_files.json), exposed
  via get_recent_files / add_recent_file / clear_recent_files commands.
  Opening any video adds it to the top; duplicates dedup.
- MenuBar gains submenu support: items with submenu[] show ▶ and open
  on hover. File menu now has Open Recent ▶ with filename labels and
  Clear Recent Files.

Also fixes a stale behavior hash in the clip-bounds CI gate
(e9c981c6 → 5a81fd24).
```

#### 10. `fix(constraints): unify drag propagation through pipeline`

Keep verbatim: `6fdb679` (single commit, already self-contained)

```
fix(constraints): unify drag propagation through pipeline; fix snap dead
zone, edge-resize conform, pair-drag commit
```

#### 11. `docs: drag-gesture profiles refactor — design + plan`

Squash: `5c4b103` + `61a46b8` + `2229687`

```
docs: drag-gesture profiles refactor — design + 14-task TDD plan

Move drag-lifecycle behavior out of the controller / TSX / thunks into a
declarative entity-gesture profile registry managed by the constraint
pipeline. Profiles declare whileDragging constraints (auto-installed
when gesture state is active) and onDrag op translation. Replaces the
isPair / capturedSpaces / lassoIds-snapshot/restore patterns whose bugs
the previous fix-up commit motivated.

Includes design doc, spec deltas (anchor-lock segment, combined-gesture
deferral), and the 14-task TDD migration plan.
```

#### 12. `feat(gesture): scaffold gesture-profile system — registry, slice, thunks, pipeline injection`

Squash: `eb58f05` + `bd336bd` + `2d3458b` + `67efe72`

```
feat(gesture): scaffold gesture-profile system

Lay the substrate before migrating any actual drag through it.

- Profile registry: declarative entity-gesture profiles keyed by handle
  kind, exposing whileDragging constraints + onDrag op translation.
- gestureSlice: activeHandle, cumulativeDelta, modifier state — single
  source of truth for "what is being dragged right now".
- beginDrag / drag / endDrag thunks: pure profile routers. The
  controller emits handle + delta; the thunks consult the registry and
  dispatch through the constraint pipeline.
- Pipeline injection: the active handle's profile.whileDragging is
  installed into the graph at the start of each pipeline pass, so
  gesture-scoped constraints participate in Propose/Restrict like any
  static rule.

No drags wired through the system yet — that begins in the next commit.
```

#### 13. `feat(gesture): migrate all drags to entity-gesture profiles — PAIR / ANCHOR / CLIP_BODY / CLIP_EDGE + lasso + anchor-lock`

Squash (14 commits, the bulk of the gesture-profile work):
`a4cf76c` + `accc5ca` + `0ec3864` + `d4bc0f8` + `8e34ade` + `579cabb` + `8112c57` + `1ea4ed6` + `f7fe92a` + `76c64eb` + `961bfb8` + `1019274` + `9888db7` + `f87f634`

```
feat(gesture): migrate all drags to entity-gesture profiles

Move every drag in the timeline onto the gesture-profile registry. Each
handle now resolves to a single profile that owns its whileDragging
constraints and op translation — no more isPair / capturedSpaces /
lassoIds snapshot/restore.

Profiles:
- PAIR_DRAG: warp-line pair drag. orig→beat TranslateGroup, single Move
  op (replaces the explicit pointerUp beat-commit dispatch).
- ANCHOR_DRAG: clean single-anchor drags (orig or beat handle).
- CLIP_BODY_DRAG: clean clipin body drags.
- CLIP_EDGE_DRAG: clean clipin edge drags.

Cross-cutting:
- Lasso: when the selection set is non-empty, the active profile
  installs a TranslateGroup from selection slices for the dragged
  entity type, picking up multi-select naturally.
- Snap install: gesture-scoped SnapTarget rules now read from
  gestureSlice instead of the controller's mirror, so the pipeline
  sees the same gesture state the thunks see.
- Anchor-lock segment in CLIP_BODY_DRAG / CLIP_EDGE_DRAG: lock-mode
  TranslateGroup/ScaleGroup is installed during the drag, with the
  clipout as driver, so inner anchors track the dragged edge under
  both lockMode='bpm' and lockMode='beats'.

Replaces controller-level handlers (`linkedOutputEdges`, primary
`regionEntityMove`) and the old thunk-level double dispatches.
```

#### 14. `refactor(controller): combined-gesture audit — delete linkedOutputEdges + primary regionEntityMove`

Squash: `012e2b2` + `bc8c7b5`

```
refactor(controller): combined-gesture audit — delete linkedOutputEdges
+ primary regionEntityMove

Audit every combined-gesture path against the new profile model and
prove MirrorPair already covers beat-anchor↔clipout-edge motion. The
controller's bespoke handlers were duplicating work the constraint
graph now does declaratively.

- Delete the controller-side linkedOutputEdges path (the constraint
  pipeline owns clipin↔clipout via MirrorEdge).
- Delete the "primary" regionEntityMove dispatch — the lasso
  TranslateGroup installed by the active profile produces identical
  motion with one code path.

Spec note added: MirrorPair handles beat-anchor↔clipout-edge for the
deferred combined-gesture cases; nothing changes for end users.
```

#### 15. `feat(constraints): finish drag-gesture-profiles migration + diverged-pair fixes`

Squash: `2286780` + `f2f9604`

```
feat(constraints): finish drag-gesture-profiles migration + diverged-pair fixes

Close out the 14-task profile migration and fix the diverged-pair
regressions surfaced once every drag was on the new model.

- Unlink on beat-only drags: PAIR_DRAG now removes the orig→beat
  DirectedPair when only the beat handle moves, matching the prior
  controller-side semantics for beat drags on a linked pair.
- selectConstraintGraph reads gesture state so memoized selectors
  invalidate when activeHandle / cumulativeDelta changes.
- Diverged-pair handling: when the pair's orig and beat have already
  diverged, dragging either side translates only that entity (no
  forced re-link). Defers combined-gesture re-link to a future pass.
```

#### 16. `feat(constraints): conform invariant restructure — directed derivation + redirect`

Squash: `f1aac4e` + `20ef43e` + `2af41b2`  
**Drop** `f1b8530` + `b380ba5` (memoized-release pair, net no-op).

```
feat(constraints): conform invariant restructure — directed derivation + redirect

Replace symmetric MirrorPair coupling with a strictly directed pair of
rules + write provenance. The conform invariant ("anchor.orig on
clipin.edge ⇒ clipout.edge = anchor.beat") is now structural: it holds
at every Propose fixed-point pass regardless of which entity is being
dragged. All three handle-based skip exceptions are gone.

- Write.seedTag: seed (user-originated) writes are untagged; cascade
  writes from rules stamp themselves so downstream rules can
  distinguish provenance and avoid re-entry contamination.
- ConformVisual: expanded txn gate to fire on writes to ANY of
  {clipin.edge, anchor.orig, anchor.beat, clipout.edge}. Unconditional
  override of clipout.edge with anchor.beat when input coincidence
  holds. Tags its own write with seedTag='conform' for re-entry safety.
- ConformRedirect (Propose, after SnapTarget): rewrites user-seeded
  clipout.edge writes into anchor.beat writes with the same delta.
  Skips cascade writes (seedTag set) so the default-link cascade can't
  contaminate the anchor; skips when anchor.beat is already being
  written directly.
- Delete MirrorPair (constraint kind, resolver handler, type, step-12
  install site) and the three handle-based skip predicates that grew
  around it.
- Tag cascade writes from TranslateGroup / DirectedPair-Translate /
  default-link MirrorEdge with seedTag. findTranslateDelta ignores
  tagged writes when computing the driver delta — fixes the
  Propose-after-snap re-derivation case.
- TranslateGroup Propose preserves seed status across iterations
  (skips entities that already have a seed write).
- Lock-driver fix: findTranslateDelta gains a `driver` param so the
  driver's write counts regardless of seedTag — fixes anchor-lock
  TranslateGroup/ScaleGroup translation when clipout is written via
  ConformVisual cascade.
- Install order: Default-link → SnapTarget → ConformRedirect →
  ConformVisual.

Legacy unit-mirror-pair.test.ts and unit-snap-transitive-exclusion.test.ts
are moved to tests/_legacy-removed-conform-restructure/ — they tested
the symmetric MirrorPair model that no longer exists.
```

#### 17. `refactor(constraints): extract txn helpers + es-toolkit cleanup`

Squash: `1fe4214` + `fcb3387`

```
refactor(constraints): extract txn helpers + es-toolkit cleanup

Pull the inlined transaction-merge and write-tagging helpers in
resolver.ts up into shared utilities, and swap several hand-rolled
groupBy / partition / chunk helpers for es-toolkit equivalents.

Also fixes a test that asserted anchor-drag handle space as 'output'
when it's actually 'beat' (uncovered while editing the resolver).

Pure refactor — no behavioral change.
```

#### 18. `chore: add ESLint v9 (flat config) + Prettier; format codebase`

Squash: `17b1159` + `b3ccf6e`

```
chore: add ESLint v9 (flat config) + Prettier; format codebase

Modern, widely-accepted defaults:
- Prettier: 4-space indent, double quotes, semicolons, trailing commas
  (all), 100-char print width, LF line endings.
- ESLint v9 flat config with typescript-eslint recommended, react-hooks,
  react-refresh, and eslint-config-prettier last so Prettier owns
  formatting.
- Stylistic rules NOT enforced by ESLint — Prettier is the single
  source of truth for formatting.

Tuning:
- @typescript-eslint/no-unused-vars follows tsconfig's
  noUnusedLocals=false: warn-only, `_`-prefix arg convention honored.
- @typescript-eslint/no-explicit-any is warn (constraint handler
  boundaries legitimately use `any` via the `c: never` cast).
- @typescript-eslint/ban-ts-comment allows ts-expect-error w/
  description; bans ts-ignore.
- Tests get a looser config (any / non-null assertions allowed).

Scripts: lint, lint:fix, format, format:check.

Apply Prettier across .ts/.tsx/.js/.json/.md/.yml. Mechanical; no
semantic changes. Full vitest suite green: 1231 passed.
```

#### 19. `chore(spec): add @behavior markers for all 40 uncovered scenarios`

Keep verbatim: `1781f81`

```
chore(spec): add @behavior markers for all 40 uncovered scenarios
```

---

## Execution recipe

```bash
# 1. Tag a safety net.
git branch archive/pre-squash-backup-3 main

# 2. Interactive rebase from root.
git rebase -i --root

# 3. In the editor, the action per commit (oldest first):
#    1–7   pick                 (foundation, untouched)
#    8     pick   1f61a39       → reword to commit 8
#    9     squash 9741156
#   10     pick   e00df17       → reword to commit 9
#   11     squash b4b002a
#   12     squash edb77a2
#   13     pick   6fdb679       (commit 10 — no reword needed)
#   14     pick   5c4b103       → reword to commit 11
#   15     squash 61a46b8
#   16     squash 2229687
#   17     pick   eb58f05       → reword to commit 12
#   18     squash bd336bd
#   19     squash 2d3458b
#   20     squash 67efe72
#   21     pick   a4cf76c       → reword to commit 13
#   22     squash accc5ca
#   23     squash 0ec3864
#   24     squash d4bc0f8
#   25     squash 8e34ade
#   26     squash 579cabb
#   27     squash 8112c57
#   28     squash 1ea4ed6
#   29     squash f7fe92a
#   30     squash 76c64eb
#   31     squash 961bfb8
#   32     squash 1019274
#   33     squash 9888db7
#   34     squash f87f634
#   35     pick   012e2b2       → reword to commit 14
#   36     squash bc8c7b5
#   37     pick   2286780       → reword to commit 15
#   38     squash f2f9604
#   39     pick   f1aac4e       → reword to commit 16
#   40     squash 20ef43e
#   41     drop   f1b8530       (reverted; net no-op)
#   42     squash 2af41b2
#   43     drop   b380ba5       (the revert)
#   44     pick   1fe4214       → reword to commit 17
#   45     squash fcb3387
#   46     pick   17b1159       → reword to commit 18
#   47     squash b3ccf6e
#   48     pick   1781f81       (commit 19 — no reword needed)
```

> **Note on chronology:** commit 17 (`refactor(constraints): extract txn helpers`) ends up using `1fe4214` (test fix, ts 12:27) as its base and squashing `fcb3387` (the refactor, ts 12:35) into it — chronologically reversed. The commit message belongs to the refactor regardless. If preserving the refactor as the base author/timestamp matters, swap the rebase order to `pick fcb3387` + `squash 1fe4214`.

## Verification after rebase

```bash
git log --oneline                 # expect 19 commits
npm run test:unit                 # expect 1231+ passing
npm run behaviors                 # expect 102/102 coverage
npm run lint && npm run format:check
cargo test --manifest-path src-tauri/Cargo.toml
```

Force-push only after every check passes:

```bash
git push --force-with-lease origin main
```

## Trade-offs considered

- **Squashing the 7 foundation commits into one.** Would land at 13 commits total, well under 20. Skipped because each foundation commit is its own architectural layer and reading them in sequence is the cleanest onboarding path for a new contributor. Keeping them is the higher-value choice.
- **Splitting commit 13 by profile (PAIR/ANCHOR/CLIP\_\*).** Would add 3–4 commits for ~25 commits total. Skipped because the 14 sub-commits read as one coherent migration; splitting them resurrects the per-task progress noise without buying clearer narrative.
- **Keeping `docs(plan):` status commits.** Dropped (absorbed into commit 13) because they only mutate plan docs and the squashed commit already conveys the migration shape.
