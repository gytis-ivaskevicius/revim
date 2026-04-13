# Vim Search (`/`, `?`, `n`, `N`)

## Context

ReVim has had `addOverlay`/`setHighlights`, `getSearchCursor`, and `processSearch` wired in
the TypeScript vim layer since story 005. The keybindings `/`, `?`, `n`, and `N` are registered
in `default-key-map.ts`. What is missing is the last mile: `TerminalStatusBar.startPrompt` is a
no-op returning `() => {}`. When `/` is pressed, `showPrompt` calls `adapter.openPrompt` which
fires `status-prompt`, which reaches `startPrompt` — and because it is a no-op the prompt never
appears, no query is captured, and nothing moves.

This story wires the prompt so that `/word<Enter>` captures input in the status bar, moves the
cursor to the first match, lights up all occurrences, and lets the user repeat with `n`/`N` or
cancel with `<Esc>`. It is purely a TypeScript change; no new Rust or NAPI surface is needed.

## Out of Scope

- `:` ex-command prompt (different prefix, different closure behaviour — separate story).
- Search-and-replace (`:%s/…/…/g`), confirm replace.
- `*` / `#` word-under-cursor search (keybindings already registered; no extra work needed, but
  not the focus of this story's E2E suite).
- `:nohl` command / clearing highlights on `<Esc>` in normal mode.
- Line/column indicator in the status bar.
- Status bar colours and theming.

## Implementation approach

### How the prompt bridge works

`VimMode.handleKey` (in `app/src/vim/index.ts`) is the single entry point for all key events.
The approach is to intercept keys there before they reach the vim state machine:

```typescript
handleKey(key: string) {
  if (this.statusBar_?.isPrompting()) {
    this.statusBar_.handlePromptKey(key)
    return
  }
  // existing vim state machine path …
}
```

`TerminalStatusBar` gains three additions:

1. A `promptState` field of type `{ prefix: string; query: string; options: StatusBarInputOptions } | null`.
2. `isPrompting(): boolean` — returns `promptState !== null`.
3. `handlePromptKey(encodedKey: string): void` — decodes the key, updates the query buffer,
   calls the `StatusBarInputOptions` callbacks, and updates the status bar display.

`startPrompt` is no longer a no-op; it sets `promptState`, calls `setStatusText(prefix)`, and
returns a closer that clears `promptState` and restores the mode label.

### Key decoding rule (encoded vim key → `StatusBarKeyEvent`)

`encodeTerminalKey` produces the following formats; map them as:

| Encoded key          | `StatusBarKeyEvent`                     |
|----------------------|-----------------------------------------|
| `'x'` (single-quoted char) | `{ key: "x" }`                  |
| `"Space"`            | `{ key: " " }`                          |
| `"Enter"`            | `{ key: "Enter" }`                      |
| `"Esc"`              | `{ key: "Escape" }`                     |
| `"Backspace"`        | `{ key: "Backspace" }`                  |
| `"Up"` / `"Down"`   | `{ key: "Up" }` / `{ key: "Down" }`    |
| `"Left"` / `"Right"`| `{ key: "Left" }` / `{ key: "Right" }` |
| `/^Ctrl-(.+)$/`      | `{ key: match[1], ctrlKey: true }`      |
| `/^Alt-(.+)$/`       | `{ key: match[1], altKey: true }`       |
| anything else        | ignored (no-op)                         |

Always attach `stopPropagation: () => {}` and `preventDefault: () => {}` to every event.
`value` and `selectionStart`/`selectionEnd` are not needed and should be omitted.

### `handlePromptKey` processing order

For each call (using `state` as shorthand for `promptState`):

1. Decode encoded key → `StatusBarKeyEvent evt`.
2. Build `close(value?: string)`:
   - `value !== undefined` → `state.query = value; setStatusText(state.prefix + value)` (history navigation).
   - `value === undefined` → `promptState = null; this.update()` (cancel prompt, restore mode label).
3. Call `state.options.onKeyDown?.(evt, state.query, close)`. After this, if `promptState` is
   null, return immediately (Esc/Ctrl-C path cancels via `close()`).
4. Update the query buffer:
   - If `evt.key === "Backspace"` and `state.query.length > 0`: `state.query = state.query.slice(0, -1)`.
   - Else if `evt.key` is a single printable character (`evt.key.length === 1` and
     `!evt.ctrlKey && !evt.altKey && !evt.metaKey`): `state.query += evt.key`.
5. `setStatusText(state.prefix + state.query)`.
6. Call `state.options.onKeyUp?.(evt, state.query, close)`. After this, if `promptState` is null,
   return (history cycling called `close()` — should not happen, but guard it).
7. If `evt.key === "Enter"`: call `state.options.onClose?.(state.query)`; `promptState = null`;
   `this.update()`.

### Highlights

`updateSearchQuery` (called by `onKeyUp` during incremental search) already calls
`highlightSearchMatches(adapter, query)` → `adapter.addOverlay(query)` → `setHighlights(ranges)`,
which Rust renders as REVERSED spans over matched characters. No new Rust code is needed.

Highlights persist after the prompt closes. They are cleared when the user cancels (`<Esc>`)
because `onPromptKeyDown` calls `clearSearchHighlight(adapter)` → `adapter.removeOverlay()`.

### `n` / `N`

These are already bound to `motion: "findNext"` in `default-key-map.ts` and routed through
`motionFindNext` in `motion-search.ts`. Once `processSearch` sets up the search state correctly
(which it will, once the prompt returns a real query), `n`/`N` work without any changes.

## Tasks

### Task 1 — Implement `TerminalStatusBar.startPrompt`, `isPrompting`, and `handlePromptKey`

Modify `app/src/vim/terminal-status-bar.ts`.

Add a private `promptState` field:

```typescript
private promptState: {
  prefix: string
  query: string
  options: StatusBarInputOptions
} | null = null
```

Add `isPrompting(): boolean { return this.promptState !== null }`.

Replace the `startPrompt` no-op with the real implementation (see approach above).
Add `handlePromptKey(encodedKey: string): void` (full algorithm in Implementation approach).
Import `StatusBarInputOptions` from `./statusbar` (already available via the existing import of
`ModeChangeEvent`; add `StatusBarInputOptions` to the same import).

#### Acceptance Criteria

- `startPrompt("/", "(JavaScript regexp)", options)` called
  - → `isPrompting()` returns `true`
  - → `setStatusText` is called with `"/"`

- `startPrompt` returned closer is called
  - → `isPrompting()` returns `false`
  - → `setStatusText` is called with the normal mode label (`"NORMAL"`)

- `handlePromptKey("'a'")` called while prompting (prefix `"/"`, empty query)
  - → internal query buffer becomes `"a"`
  - → `setStatusText` is called with `"/a"`
  - → `options.onKeyUp` is called with `("a", close)` — the query arg is `"a"`

- `handlePromptKey("'a'")`, then `handlePromptKey("Backspace")` called
  - → query buffer becomes `""` after backspace
  - → `setStatusText` called with `"/"`

- `handlePromptKey("Backspace")` on empty query
  - → `onKeyDown` calls `close()` (cancel); `isPrompting()` returns `false`
  - → `setStatusText` restores mode label

- `handlePromptKey("Enter")` with query `"foo"` in buffer
  - → `options.onClose` called with `"foo"`
  - → `isPrompting()` returns `false`

- `handlePromptKey("Esc")` called (Esc triggers `close()` inside `onPromptKeyDown`)
  - → `isPrompting()` returns `false`
  - → `options.onClose` is NOT called (cancelled, not submitted)

- `handlePromptKey("Space")` with empty query
  - → query buffer becomes `" "` (space is treated as printable)
  - → `setStatusText` called with `"/ "`

#### Non-Automatable

None.

---

### Task 2 — Route keys through `handlePromptKey` in `VimMode.handleKey`

Modify `app/src/vim/index.ts`, `VimMode.handleKey`:

```typescript
handleKey(key: string) {
  if (this.statusBar_?.isPrompting()) {
    this.statusBar_.handlePromptKey(key)
    return
  }
  // existing state machine path …
}
```

#### Acceptance Criteria

- `VimMode.handleKey` called while `statusBar.isPrompting()` returns `true`
  - → `statusBar.handlePromptKey` is called with the encoded key
  - → the vim state machine (keymap `call`) is NOT invoked

- `VimMode.handleKey` called while `statusBar.isPrompting()` returns `false`
  - → `statusBar.handlePromptKey` is NOT called
  - → normal vim processing continues

#### Non-Automatable

None.

---

### Task 3 — E2E tests for search prompt, movement, highlights, and cancellation

Add a new file `app/tests/e2e/search.test.ts`. Use `test`, `expect`, `keyPress`,
`keyEscape`, `RENDER_DELAY_MS`, and `KEY_PRESS_DELAY_MS` from `./test-utils.js`.

The demo buffer contains the following text (lines 0–6):

```
Welcome to ReVim!
(empty)
This is a demo text for the TUI.
Use arrow keys to move the cursor.
Press Ctrl+C to exit.
(empty)
The cursor wraps around edges.
```

The word `"cursor"` appears on lines 3, 4, and 6. The word `"demo"` appears only on line 2.

All tests start at the default cursor position (line 0, col 0 — `terminal.getCursor()` reflects
the visual position with the border offset of 1).

Use a helper to send a search command:

```typescript
async function typeSearch(terminal: any, query: string, delay: number) {
  keyPress(terminal, "/")
  await new Promise(r => setTimeout(r, delay))
  for (const ch of query) {
    keyPress(terminal, ch)
    await new Promise(r => setTimeout(r, delay))
  }
  keyPress(terminal, "Enter")
  await new Promise(r => setTimeout(r, delay))
}
```

#### Acceptance Criteria

**Status bar shows prompt prefix while typing**

- start + press `/`
  - → status bar shows text beginning with `"/"` (prompt prefix visible)

- start + press `/`, then type `"cu"`
  - → status bar shows `"/cu"` (prefix + partial query)

- start + press `/`, then `<Esc>`
  - → status bar shows `"NORMAL"` (prompt cancelled, mode label restored)
  - → cursor position unchanged (at initial position)

**Forward search `/` moves cursor**

- start + `/cursor<Enter>`
  - → `terminal.getCursor()` y-coordinate is on line 3 (first occurrence of `"cursor"`)

- start + `/demo<Enter>`
  - → `terminal.getCursor()` y-coordinate is on line 2 (only occurrence of `"demo"`)

**`n` advances to next occurrence**

- start + `/cursor<Enter>` (lands on line 3) + `n`
  - → `terminal.getCursor()` y-coordinate is on line 4 (second occurrence)

- start + `/cursor<Enter>` + `n` + `n`
  - → `terminal.getCursor()` y-coordinate is on line 6 (third occurrence)

**`N` moves to previous occurrence**

- start + `/cursor<Enter>` (line 3) + `n` (line 4) + `N`
  - → `terminal.getCursor()` y-coordinate is back on line 3

**Backward search `?` moves cursor in reverse**

- cursor on last content line (move down to line 6 first via ArrowDown × 6) + `?cursor<Enter>`
  - → `terminal.getCursor()` y-coordinate is on line 4 or line 3 (first occurrence searching
    backward from line 6 — the nearest previous match)

**Search wrap-around**

- start (line 0) + `/cursor<Enter>` + `n` + `n` (lands on line 6) + `n`
  - → `terminal.getCursor()` y-coordinate wraps back to line 3 (first occurrence)

**No-match query does not crash**

- start + `/zzznomatch<Enter>`
  - → app is still running (status bar visible)
  - → `terminal.getCursor()` stays at initial position (no movement on no-match)

**Search highlights appear**

- start + `/cursor<Enter>`
  - → `terminal.getByText("cursor")` is visible (at least one highlighted match rendered)
  - → snapshot with `includeColors: true` shows a cell with non-zero `inverse` on the
    matched word on line 3 (regression guard)

**Esc-cancel does not move cursor or leave highlights**

- start + `/cursor`, then `<Esc>` (before Enter)
  - → cursor stays at initial position (no movement)
  - → status bar shows `"NORMAL"`
  - → snapshot with `includeColors: true` shows no REVERSED cells on line 3 (highlights cleared)

#### Non-Automatable

Manual verification in `just dev`: the `/` prompt should appear in the status bar at the
bottom, characters should echo as you type (e.g. `/fo`), pressing Enter should jump to the
first match, and pressing `n` should move to subsequent matches. The terminal highlight colour
(REVERSED on match cells) should be visually distinct from plain text.

## Technical Context

- `@microsoft/tui-test` `0.0.3` (installed; `0.0.4` available on npm but not yet adopted) — `getByText`, `toBeVisible`, `toMatchSnapshot({ includeColors: true })`, `getCursor()`, `terminal.key()` all stable in the installed version.
- `StatusBarInputOptions` is already exported from `app/src/vim/statusbar.ts`; just add it to the import in `terminal-status-bar.ts`.
- `setStatusText` is already imported in `terminal-status-bar.ts` from `@revim/lib`.
- Rust `set_highlights` and `HighlightRange` are already exposed via NAPI and imported in `adapter.ts` as `setHighlights`. No Rust changes needed.
- `processSearch` + `onPromptClose` + `onPromptKeyDown` + `onPromptKeyUp` are all in `app/src/vim/command-dispatcher.ts` — do not modify them.
- The key routing guard `this.statusBar_?.isPrompting()` uses optional chaining because `statusBar_` is typed as `IStatusBar | undefined`; `isPrompting` must be added to the `IStatusBar` interface in `app/src/vim/statusbar.ts`.

## Notes

- `IStatusBar` in `statusbar.ts` must gain `isPrompting(): boolean` and `handlePromptKey(encodedKey: string): void` so the `VimMode.handleKey` optional-chaining access compiles. The no-op implementation for any future mock/stub is: `isPrompting() { return false }` / `handlePromptKey(_: string) {}`.
- The `update()` private method in `TerminalStatusBar` already handles mode label rendering; calling it after `promptState = null` correctly restores the label.
- Do not call `this.update()` while `promptState` is non-null — use `setStatusText(prefix + query)` directly to avoid the mode label overwriting the prompt text.
- `encodeTerminalKey` is called with `insertMode = false` during prompt (vim state is still normal mode). This means the space key arrives as the string `"Space"`, not `"' '"`. The decode rule above handles this explicitly.
- After search completes, highlights remain until cancelled or a new search is started. This is correct vim behaviour for MVP; `:nohl` is out of scope.
