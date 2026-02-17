## Milestones (1-13 snapshot)
- [x] #1 Bonus dice/conditional critical duplication
- [x] #2 C'est Sit Bon incompat (multi-apply)
- [x] #3 `extraDice` critical-rule handling
- [x] #4 Spell-level/scaling support for granted bonus effects
- [x] #5 Extra critical damage dice improvements
- [x] #6 Dice size upgrade/downgrade flags
- [x] #7 Opt-in flags system (ongoing UX polish)
- [ ] #8 Override activity ability mod via flag (reverted/deferred)
- [x] #9 Build status effect tables once on load
- [ ] #10 Rolls without scene token support (partial)
- [x] #11 Rework `_getConfig` + originating message reuse (core layering + reuse path complete)
- [ ] #12 Rethink `_preUseActivity` / use-flags support (partial)
- [x] #13 Range flags for granular autoRanged control (baseline complete; follow-up recomputation polish deferred below)

## Completed Since Snapshot
- [x] Preserve third-party d20 optional bonus parts during AC5E baseline restore/rebuild cycles.
- [x] Add localized auto-generated opt-in descriptions and sync locale key coverage.
- [x] Refine DAE autocomplete keys: explicit AC5E per-action paths and damage-only dice up/down keys.

## Deferred / Feedback
- [ ] Awaiting user feedback: consider showing evaluated opt-in bonus in the label (for example `(+2)`) to make impact clearer without toggling.
  - Overhead: per-hook/per-roll-part recomputation and UI relabeling on every dialog rebuild; risk of stale/misleading values for dynamic formulas.
  - Low-overhead compromise: only show static numeric bonuses (for example `+2`), skip dynamic/formula-based entries, and gate behind a setting (default off).
- [ ] Deferred: rework attack dialog range opt-in recomputation to avoid stale forced-fail AC (`999`) state while preserving button highlight, tooltip refresh, and opt-in UI behavior.
  - Current status: rolled back experimental transient-target rewrite due to regressions in d20 dialog updates.
  - Next pass goal: isolate target AC syncing from dialog UI state updates, then reintroduce with narrower scope (this is the remaining follow-up for milestone #13, not the baseline range-flag implementation itself).
- [ ] Deferred: add local-only i18n key sync/check tooling (do not ship in module package).
  - Keep helper scripts outside tracked files (for example `.devtools/i18n-sync-keys.mjs` and `.devtools/i18n-check-keys.mjs`), ignored via `.git/info/exclude`.
  - Manual release flow: update `lang/en.json` keys -> run sync helper to copy missing keys into non-English locales with English fallback text -> run check helper and verify `missing=0` for all locales.
- [ ] Deferred: harden aura formula evaluation when `auraActor.*` references are left unresolved.
  - Symptom: expressions like `1d20 + auraActor.abilities.str.mod` can survive as raw text when actor-data resolution fails during parser replacement.
  - Investigate `_ac5eActorRollData` strict actor guard and allow capability-based roll-data extraction (`actor?.getRollData`) for aura sources.
  - Add parser fallback in `resolveActorAtRefs` to direct property lookup (for example `foundry.utils.getProperty`) when `Roll('@path', actor)` throws, so unresolved `auraActor.*` paths do not leak into final formulas.
- [ ] Deferred: validate MidiQOL compatibility for AC5E target/AC rewrites, especially `modifyAC`.
  - MidiQOL snapshots `flags.dnd5e.targets` during its `preRollAttack` handling and may not observe later AC5E updates.
  - Verify full attack flow with Midi enabled (single and multi-target) to identify where AC5E-adjusted AC diverges from Midi workflow data.
  - Define and implement bridge data updates into Midi workflow context (for example workflow target data/derived target values) so AC5E `modifyAC` is honored end-to-end.
