## Milestones (1-13 snapshot)
- [x] #1 Bonus dice/conditional critical duplication
- [x] #2 C'est Sit Bon incompat (multi-apply)
- [x] #3 `extraDice` critical-rule handling
- [x] #4 Spell-level/scaling support for granted bonus effects
- [ ] #5 Extra critical damage dice improvements (partial)
- [x] #6 Dice size upgrade/downgrade flags
- [x] #7 Opt-in flags system (ongoing UX polish)
- [ ] #8 Override activity ability mod via flag (reverted/deferred)
- [x] #9 Build status effect tables once on load
- [ ] #10 Rolls without scene token support (partial)
- [ ] #11 Rework `_getConfig` + originating message reuse (in progress)
- [ ] #12 Rethink `_preUseActivity` / use-flags support (partial)
- [ ] #13 Range flags for granular autoRanged control (not started)

## Deferred / Feedback
- [ ] Awaiting user feedback: consider showing evaluated opt-in bonus in the label (for example `(+2)`) to make impact clearer without toggling.
  - Overhead: per-hook/per-roll-part recomputation and UI relabeling on every dialog rebuild; risk of stale/misleading values for dynamic formulas.
  - Low-overhead compromise: only show static numeric bonuses (for example `+2`), skip dynamic/formula-based entries, and gate behind a setting (default off).
