import type {
  ActionArgs,
  CmSelection,
  ExArgs,
  MotionArgs,
  OperatorMotionArgs,
  Pos,
  SearchArgs,
  VimOptions,
} from "@revim/vim-keybindings"
import type { Marker } from "./adapter"
import type { InputState } from "./input-state"
import type { MotionFunc } from "./motions"
import type { SearchState } from "./search"

export interface LastSelection {
  anchorMark: Marker
  headMark: Marker
  anchor: Pos
  head: Pos
  visualMode: boolean
  visualLine: boolean
  visualBlock: boolean
}

export interface VimState {
  inputState: InputState
  // Vim's input state that triggered the last edit, used to repeat
  // motions and operators with '.'.
  lastEditInputState?: InputState
  // Vim's action command before the last edit, used to repeat actions
  // with '.' and insert mode repeat.
  lastEditActionCommand?: KeyMappingAction
  // When using jk for navigation, if you move from a longer line to a
  // shorter line, the cursor may clip to the end of the shorter line.
  // If j is pressed again and cursor goes to the next line, the
  // cursor should go back to its horizontal position on the longer
  // line if it can. This is to keep track of the horizontal position.
  lastHPos: number
  // Doing the same with screen-position for gj/gk
  lastHSPos: number
  // The last motion command run. Cleared if a non-motion command gets
  // executed in between.
  lastMotion?: MotionFunc
  marks: Record<string, Marker>
  insertMode: boolean
  // Repeat count for changes made in insert mode, triggered by key
  // sequences like 3,i. Only exists when insertMode is true.
  insertModeRepeat?: number
  insertDigraph?: boolean
  visualMode: boolean
  // If we are in visual line mode. No effect if visualMode is false.
  visualLine: boolean
  visualBlock: boolean
  lastSelection?: LastSelection
  lastPastedText?: string
  sel: CmSelection
  // Buffer-local/window-local values of vim options.
  options: VimOptions

  searchState_?: SearchState
  exMode?: boolean
}

export interface OperatorArgs {
  indentRight?: boolean
  toLower?: boolean
  linewise?: boolean
  shouldMoveCursor?: boolean
  fullLine?: boolean
  selectedCharacter?: string
  lastSel?: Pick<LastSelection, "anchor" | "head" | "visualBlock" | "visualLine">
  repeat?: number
  registerName?: string
}

export type Context = "insert" | "normal" | "visual"

export type MappableArgType = MotionArgs | ActionArgs | OperatorArgs | OperatorMotionArgs | SearchArgs | ExArgs

export type KeyMappingDefault<T> = { type: T; keys: string; context?: Context; repeatOverride?: number }

export type KeyMappingKeyToKey = KeyMappingDefault<"keyToKey"> & { toKeys: string }
export type KeyMappingIdle = KeyMappingDefault<"idle">
export type KeyMappingKeyToEx = KeyMappingDefault<"keyToEx"> & { exArgs: ExArgs }
export type KeyMappingEx = KeyMappingDefault<"ex"> & { ex?: string; exArgs?: ExArgs }
export type KeyMappingMotion = KeyMappingDefault<"motion"> & { motion: string; motionArgs?: MotionArgs }
export type KeyMappingOperator = KeyMappingDefault<"operator"> & {
  operator: string
  operatorArgs?: OperatorArgs
  exitVisualBlock?: boolean
  isEdit?: boolean
}
export type KeyMappingOperatorMotion = KeyMappingDefault<"operatorMotion"> & {
  operator?: string
  operatorMotion?: string
  motion?: string
  motionArgs?: MotionArgs
  operatorArgs?: OperatorArgs
  operatorMotionArgs?: OperatorMotionArgs
  exitVisualBlock?: boolean
  isEdit?: boolean
}
export type KeyMappingAction = KeyMappingDefault<"action"> & {
  action: string
  actionArgs?: ActionArgs
  motion?: string
  motionArgs?: MotionArgs
  operator?: string
  operatorArgs?: OperatorArgs
  isEdit?: boolean
  interlaceInsertRepeat?: boolean
  exitVisualBlock?: boolean
}
export type KeyMappingSearch = KeyMappingDefault<"search"> & { searchArgs: SearchArgs }

export type KeyMapping =
  | KeyMappingKeyToKey
  | KeyMappingIdle
  | KeyMappingKeyToEx
  | KeyMappingEx
  | KeyMappingMotion
  | KeyMappingOperator
  | KeyMappingOperatorMotion
  | KeyMappingAction
  | KeyMappingSearch
