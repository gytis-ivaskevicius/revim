import type { Binding, IEditorAdapter, KeyMapEntry } from "./adapter-interface"
import type { ExCommandOptionalParameters } from "./adapter-types"

export const keyMap: Record<string, KeyMapEntry> = {
  default: { find: () => true },
}

export const commands: Record<string, (adapter: IEditorAdapter, params: ExCommandOptionalParameters) => void> = {
  redo: (adapter) => {
    adapter.redo()
  },
  undo: (adapter) => {
    adapter.undo()
  },
  undoLine: (adapter) => {
    adapter.undoLine()
  },
  newlineAndIndent: (adapter) => {
    adapter.triggerEditorAction("editor.action.insertLineAfter")
  },
}

export function lookupKey(
  key: string,
  map: string | KeyMapEntry,
  handle?: (binding: Binding) => boolean,
): "nothing" | "multi" | "handled" | undefined {
  if (typeof map === "string") {
    map = keyMap[map]
  }

  const found = map.find ? map.find(key) : map.keys ? map.keys[key] : undefined

  if (found === false) return "nothing"
  if (found === "...") return "multi"
  if (found !== null && found !== undefined && handle?.(found as string)) return "handled"

  if (map.fallthrough) {
    if (!Array.isArray(map.fallthrough)) return lookupKey(key, map.fallthrough, handle)
    for (let i = 0; i < map.fallthrough.length; i++) {
      const result = lookupKey(key, map.fallthrough[i], handle)
      if (result) return result
    }
  }
}
