# Constraints Tests

Two flavors of tests live here, distinguished by filename prefix:

- **`unit-*.test.ts`** — primitive / business-logic tests. Each file targets
  one constraint kind, one pipeline mechanism, or one pure helper. Asserts
  behavior at the smallest possible surface (e.g., one `reduce()` call).

- **`scenario-*.test.ts`** — user-facing scenario tests. Each file describes
  a drag gesture or conform interaction the user can perform, set up via
  the store + thunk dispatch path. These are marked for future BDD port
  (one `.feature` per scenario file).

When porting a scenario test to BDD, the test stays here until the BDD
covers the equivalent behavior, then this file is deleted.
