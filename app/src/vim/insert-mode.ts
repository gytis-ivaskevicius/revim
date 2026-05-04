import type { Change } from "@revim/vim-keybindings"
import EditorAdapter, { type BindingFunction } from "./adapter"
import { commandDispatcher } from "./command-dispatcher"
import { vimGlobalState } from "./global"
import type { MacroModeState } from "./macro-mode-state"
import type { VimState } from "./types"
import { offsetCursor, selectForInsert } from "./vim-utils"

export interface InsertModeChanges {
  changes: string[]
  expectCursorActivityForChange: boolean
  visualBlock?: number
  ignoreCount?: number
  maybeReset?: boolean
}

// Returns an object to track the changes associated insert mode.  It
// clones the object that is passed in, or creates an empty object one if
// none is provided.
export const createInsertModeChanges = (c?: InsertModeChanges) =>
  c
    ? // Copy construction
      { ...c }
    : {
        // Change list
        changes: [],
        // Set to true on change, false on cursorActivity.
        expectCursorActivityForChange: false,
      }

/** Wrapper for special keys pressed in insert mode */
export class InsertModeKey {
  readonly keyName: string
  constructor(keyName: string) {
    this.keyName = keyName
  }
}

export function logKey(macroModeState: MacroModeState, key: string) {
  if (macroModeState.isPlaying) {
    return
  }
  const registerName = macroModeState.latestRegister!
  const register = vimGlobalState.registerController.getRegister(registerName)
  if (register) {
    register.pushText(key)
  }
}

function logInsertModeChange(macroModeState: MacroModeState) {
  if (macroModeState.isPlaying) {
    return
  }
  const registerName = macroModeState.latestRegister!
  const register = vimGlobalState.registerController.getInternalRegister(registerName)
  if (register?.pushInsertModeChanges) {
    register.pushInsertModeChanges(macroModeState.lastInsertModeChanges)
  }
}

export function logSearchQuery(macroModeState: MacroModeState, query: string) {
  if (macroModeState.isPlaying) {
    return
  }
  const registerName = macroModeState.latestRegister!
  const register = vimGlobalState.registerController.getInternalRegister(registerName)
  if (register?.pushSearchQuery) {
    register.pushSearchQuery(query)
  }
}

/**
 * Listens for changes made in insert mode.
 * Should only be active in insert mode.
 */
export function onChange(adapter: EditorAdapter, change: Change): void {
  let changeObj: Change | undefined = change
  const macroModeState = vimGlobalState.macroModeState
  const lastChange = macroModeState.lastInsertModeChanges
  if (!macroModeState.isPlaying) {
    while (changeObj) {
      lastChange.expectCursorActivityForChange = true
      if (lastChange.ignoreCount! > 1) {
        lastChange.ignoreCount!--
      } else if (
        changeObj.origin === "+input" ||
        changeObj.origin === "paste" ||
        changeObj.origin === undefined /* only in testing */
      ) {
        const selectionCount = adapter.listSelections().length
        if (selectionCount > 1) lastChange.ignoreCount = selectionCount
        const text = changeObj.text.join("\n")
        if (lastChange.maybeReset) {
          lastChange.changes = []
          lastChange.maybeReset = false
        }
        if (text) {
          if (adapter.state.overwrite && !/\n/.test(text)) {
            lastChange.changes.push(text)
          } else {
            lastChange.changes.push(text)
          }
        }
      }
      // Change objects may be chained with next.
      changeObj = changeObj.next
    }
  }
}

export function exitInsertMode(adapter: EditorAdapter) {
  const vim = adapter.state.vim as VimState
  const macroModeState = vimGlobalState.macroModeState
  const insertModeChangeRegister = vimGlobalState.registerController.getRegister(".")
  const isPlaying = macroModeState.isPlaying
  const lastChange = macroModeState.lastInsertModeChanges
  if (!isPlaying) {
    adapter.off("change", onChange)
  }
  if (!isPlaying && vim.insertModeRepeat! > 1) {
    // Perform insert mode repeat for commands like 3,a and 3,o.
    repeatLastEdit(adapter, vim, vim.insertModeRepeat! - 1, true /** repeatForInsert */)
    vim.lastEditInputState!.repeatOverride = vim.insertModeRepeat
  }
  delete vim.insertModeRepeat
  vim.insertMode = false
  vim.insertDigraph = undefined
  adapter.setCursor(adapter.getCursor().line, adapter.getCursor().ch - 1)
  adapter.setOption("keyMap", "vim")
  adapter.setOption("disableInput", true)
  adapter.toggleOverwrite(false) // exit replace mode if we were in it.
  // update the ". register before exiting insert mode
  insertModeChangeRegister.setText(lastChange.changes.join(""))
  adapter.emitVimModeChange({ mode: "normal" })
  if (macroModeState.isRecording) {
    logInsertModeChange(macroModeState)
  }
  adapter.enterVimMode()
}

/**
 * Repeats the last edit, which includes exactly 1 command and at most 1
 * insert. Operator and motion commands are read from lastEditInputState,
 * while action commands are read from lastEditActionCommand.
 *
 * If repeatForInsert is true, then the function was called by
 * exitInsertMode to repeat the insert mode changes the user just made. The
 * corresponding enterInsertMode call was made with a count.
 */
export function repeatLastEdit(adapter: EditorAdapter, vim: VimState, repeat: number, repeatForInsert: boolean) {
  const macroModeState = vimGlobalState.macroModeState
  macroModeState.isPlaying = true
  const isAction = !!vim.lastEditActionCommand
  const cachedInputState = vim.inputState
  const repeatCommand = () => {
    if (isAction) {
      commandDispatcher.processAction(adapter, vim, vim.lastEditActionCommand!)
    } else {
      commandDispatcher.evalInput(adapter, vim)
    }
  }
  const repeatInsert = (repeat: number) => {
    if (macroModeState.lastInsertModeChanges.changes.length > 0) {
      // For some reason, repeat cw in desktop VIM does not repeat
      // insert mode changes. Will conform to that behavior.
      repeat = !vim.lastEditActionCommand ? 1 : repeat
      const changeObject = macroModeState.lastInsertModeChanges
      repeatInsertModeChanges(adapter, changeObject.changes, repeat)
    }
  }
  vim.inputState = vim.lastEditInputState!
  if (isAction && vim.lastEditActionCommand?.interlaceInsertRepeat) {
    // o and O repeat have to be interlaced with insert repeats so that the
    // insertions appear on separate lines instead of the last line.
    for (let i = 0; i < repeat; i++) {
      repeatCommand()
      repeatInsert(1)
    }
  } else {
    if (!repeatForInsert) {
      // Hack to get the cursor to end up at the right place. If I is
      // repeated in insert mode repeat, cursor will be 1 insert
      // change set left of where it should be.
      repeatCommand()
    }
    repeatInsert(repeat)
  }
  vim.inputState = cachedInputState
  if (vim.insertMode && !repeatForInsert) {
    // Don't exit insert mode twice. If repeatForInsert is set, then we
    // were called by an exitInsertMode call lower on the stack.
    exitInsertMode(adapter)
  }
  macroModeState.isPlaying = false
}

export function repeatInsertModeChanges(adapter: EditorAdapter, changes: (string | InsertModeKey)[], repeat: number) {
  const keyHandler = (binding: string | string[] | BindingFunction): boolean => {
    if (typeof binding === "string") {
      EditorAdapter.commands[binding](adapter, {})
    } else if (Array.isArray(binding)) {
    } else {
      binding(adapter)
    }
    return true
  }
  const head = adapter.getCursor("head")
  const visualBlock = vimGlobalState.macroModeState.lastInsertModeChanges.visualBlock
  if (visualBlock) {
    // Set up block selection again for repeating the changes.
    selectForInsert(adapter, head, visualBlock + 1)
    repeat = adapter.listSelections().length
    adapter.setCursor(head)
  }
  for (let i = 0; i < repeat; i++) {
    if (visualBlock) {
      adapter.setCursor(offsetCursor(head, i, 0))
    }
    for (let j = 0; j < changes.length; j++) {
      const change = changes[j]
      if (change instanceof InsertModeKey) {
        EditorAdapter.lookupKey(change.keyName, "vim-insert", keyHandler)
      } else if (typeof change === "string") {
        adapter.replaceSelections([change])
      }
    }
  }
  if (visualBlock) {
    adapter.setCursor(offsetCursor(head, 0, 1))
  }
}
