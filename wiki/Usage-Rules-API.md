# Usage Rules API

Applies to version: `13.5250.6`

AC5e exposes usage-rule helpers under:

```js
ac5e.usageRules
```

## Methods

- `register(definition)` -> `key | null`
- `remove(key)` -> `boolean`
- `clear()` -> `void` (runtime entries only)
- `list()` -> `Array`
- `canPersist()` -> `boolean`
- `reloadPersistent()` -> `Array`

## Registration

```js
ac5e.usageRules.register({
  key: "isSneak",
  hook: "damage",
  target: "subject",
  mode: "bonus",
  value: "@scale.rogue.sneak-attack",
  cadence: "oncePerTurn",
  condition: "rollingActor.items.some(i=>i.identifier==='sneak-attack' || i.name === 'Sneak Attack') && (rwak || (mwak && fin)) && (hasAdvantage || (!hasDisadvantage && checkNearby(opponentId, 'enemy', 5, {count:(distance <= 5 ? 2 : 1)})))",
  optin: true,
  name: "Sneak Attack",
  scope: "universal"
});
```

Supported definition fields include:

- `key`, `hook`, `target`, `mode`
- `value`/`bonus`, `set`, `modifier`, `threshold`
- `chance`, `addTo`, `usesCount`
- `condition` (string expression), `evaluate` (runtime function)
- `cadence`, `optin`, `name`, `description`
- `effectName`, `effectUuid`, `sourceUuid` (label/source hints)
- `persistent` (boolean)
- `scope` (`"effect"` default, or `"universal"`)

## Scope behavior

- `scope: "effect"` (default):
  - Registers the key as a runtime keyword for sandbox expressions.
  - Does not auto-create a global pseudo-flag entry.
  - Intended for effect-driven usage, where real AC5e flags reference the key (for example `... | isSneak`).
- `scope: "universal"`:
  - Registers the key in sandbox expressions.
  - Also emits a direct usage-rule pseudo-flag entry for matching hook/target/mode/value.
  - Intended for world-wide/global behavior without requiring an effect flag.

## Opt-in compatibility note

- AC5E opt-in selection depends on roll configuration dialogs.
- If another module forces `dialog.configure = false`, AC5E opt-in controls cannot be displayed.

## Key uniqueness

- Usage rules are uniquely identified by `key`.
- You cannot have two active entries with the exact same key (for example one `effect` and one `universal`).
- Registering a rule with an existing key replaces that key's previous entry.
- Runtime and persistent registries are merged by key; runtime wins if both define the same key.
- If you need both behaviors, use two different keys (for example `isSneakEffect` and `isSneakUniversal`).

## Persistence

To persist a rule world-wide:

```js
ac5e.usageRules.register({
  key: "isSneak",
  hook: "damage",
  target: "subject",
  mode: "bonus",
  value: "@scale.rogue.sneak-attack",
  scope: "universal",
  persistent: true
});
```

Behavior:

- Runtime rules are client-local (per client session).
- Persistent rules are world-level (module setting), shared across clients, and survive reloads.
- Persistent writes are GM-authorized; non-GM clients route through `activeGM.query(...)`.

## `evaluate` and persistence

- `evaluate` functions work for runtime registration.
- `evaluate` cannot be serialized into world settings.
- If `persistent: true` is used together with `evaluate`, AC5e falls back to runtime registration for that rule.
- For persistent behavior, use `condition` string expressions.

## Label behavior

For usage-rule opt-ins, labels resolve as:

1. Primary name: registered `name` when provided.
2. Fallback primary name: `effectName`, then resolved `effectUuid`/`sourceUuid` document name, then `key`.
3. Optional suffix name: inline `name=...` from the rule value, shown only when distinct from primary.

This avoids duplicate labels and supports explicit API-first naming.
