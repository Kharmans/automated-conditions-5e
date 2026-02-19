# Context Keywords API

Applies to version: `13.5250.6`

AC5e exposes context keyword helpers under:

```js
ac5e.contextKeywords
ac5e.contextOverrideKeywords
```

Keywords evaluate into booleans and are injected into the AC5e evaluation sandbox.

## `ac5e.contextKeywords` methods

- `register({ key, expression | evaluate, name })` -> `key | null`
- `remove(key)` -> `boolean`
- `clear()` -> `void`
- `list({ source = "all" } = {})` -> `Array`
- `canPersist()` -> `boolean`
- `isPlayerPersistEnabled()` -> `boolean`
- `setPlayerPersistEnabled(enabled)` -> `Promise<boolean>` (GM only)
- `registerPersistent({ key, expression, name })` -> `Promise<key | null>`
- `removePersistent(key)` -> `Promise<boolean>`
- `clearPersistent()` -> `Promise<boolean>`
- `reloadPersistent()` -> `Array`
- `applyToSandbox(sandbox)` -> `sandbox`

## Runtime registration

```js
ac5e.contextKeywords.register({
  key: "isBoss",
  expression: "subject.details.cr >= 10"
});
```

Function-based runtime keyword:

```js
ac5e.contextKeywords.register({
  key: "isWounded",
  evaluate: (sandbox) => Number(sandbox.subject?.attributes?.hp?.value ?? 0) < 10
});
```

## Proxy shorthand

```js
ac5e.contextOverrideKeywords.isBoss = "subject.details.cr >= 10";
ac5e.contextOverrideKeywords.isWounded = (sandbox) => sandbox.subject?.attributes?.hp?.value < 10;
delete ac5e.contextOverrideKeywords.isBoss;
```

## Persistent keywords

Persistent keywords are stored in module settings and replicated through GM-authorized updates.

```js
await ac5e.contextKeywords.registerPersistent({
  key: "isNight",
  expression: "canvas.scene.environment.darknessLevel > 0.5"
});
```

## List and inspect

```js
ac5e.contextKeywords.list(); // merged runtime + persistent
ac5e.contextKeywords.list({ source: "runtime" });
ac5e.contextKeywords.list({ source: "persistent" });
```

## Ready hook

Use the hook to register integrations:

```js
Hooks.on("ac5e.contextKeywordsReady", ({ contextKeywords, contextOverrideKeywords }) => {
  contextKeywords.register({ key: "isPartyLead", expression: "subject.name === 'Alice'" });
});
```

## Notes

- Runtime entries can use `expression` or `evaluate`.
- Persistent entries accept expression-based definitions (serializable).
- If runtime and persistent share the same key, runtime takes precedence in merged listing/sandbox application.
