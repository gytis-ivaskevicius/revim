import type { Pos } from "./common"

export class CmSelection {
  readonly anchor: Pos
  readonly head: Pos

  constructor(anchor: Pos, head: Pos) {
    this.anchor = anchor
    this.head = head
  }

  from(): Pos {
    if (this.anchor.line < this.head.line) {
      return this.anchor
    } else if (this.anchor.line === this.head.line) {
      return this.anchor.ch < this.head.ch ? this.anchor : this.head
    } else {
      return this.head
    }
  }

  empty(): boolean {
    return this.anchor.line === this.head.line && this.anchor.ch === this.head.ch
  }
}

export interface Change {
  text: string[]
  origin: "+input" | "paste"
  next?: Change
}

interface Operation {
  lastChange?: Change
  change?: Change
  selectionChanged?: boolean
  isVimOp?: boolean
}

export interface ExCommandOptionalParameters {
  argString?: string
}

// Exported for use by adapter.ts only; not re-exported from adapter.ts (internal implementation detail).
export type { Operation }
