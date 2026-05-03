import type EditorAdapter from "./adapter"
import { cursorEqual, inArray, isNumber, isPos, makePos, type Pos } from "./common"
import { vimGlobalState } from "./global"
import { defineOption, getOption } from "./options"
import { getSearchState, searchOverlay } from "./search"
import type { StatusBarInputOptions } from "./statusbar"
import { StringStream } from "./string-stream"

defineOption("pcre", true, "boolean")

export function escapeRegex(s: string) {
  return s.replace(/([.?*+$[\]/\\(){}|-])/g, "\\$1")
}

export function splitBySlash(argString: string) {
  return splitBySeparator(argString, "/")
}

export function findUnescapedSlashes(argString: string) {
  return findUnescapedSeparators(argString, "/")
}

export function splitBySeparator(argString: string, separator: string) {
  const slashes = findUnescapedSeparators(argString, separator) || []
  if (!slashes.length) return []
  // in case of strings like foo/bar
  if (slashes[0] !== 0) return

  return slashes.map((s, i) => (i < slashes.length - 1 ? argString.substring(s + 1, slashes[i + 1]) : ""))
}

export function findUnescapedSeparators(str: string, separator?: string) {
  if (!separator) separator = "/"

  let escapeNextChar = false
  const slashes: number[] = []
  for (let i = 0; i < str.length; i++) {
    const c = str.charAt(i)
    if (!escapeNextChar && c === separator) {
      slashes.push(i)
    }
    escapeNextChar = !escapeNextChar && c === "\\"
  }
  return slashes
}

// Translates a search string from ex (vim) syntax into javascript form.
function translateRegex(str: string) {
  // When these match, add a '\' if unescaped or remove one if escaped.
  const specials = "|(){"
  // Remove, but never add, a '\' for these.
  const charsToUnescape = "}"
  let escapeNextChar = false
  const out: string[] = []
  for (let i = -1; i < str.length; i++) {
    const c = str.charAt(i) || ""
    const n = str.charAt(i + 1) || ""
    let specialComesNext = n && specials.indexOf(n) !== -1
    if (escapeNextChar) {
      if (c !== "\\" || !specialComesNext) {
        out.push(c)
      }
      escapeNextChar = false
    } else {
      if (c === "\\") {
        escapeNextChar = true
        // Treat the unescape list as special for removing, but not adding '\'.
        if (n && charsToUnescape.indexOf(n) !== -1) {
          specialComesNext = true
        }
        // Not passing this test means removing a '\'.
        if (!specialComesNext || n === "\\") {
          out.push(c)
        }
      } else {
        out.push(c)
        if (specialComesNext && n !== "\\") {
          out.push("\\")
        }
      }
    }
  }
  return out.join("")
}

// Translates the replace part of a search and replace from ex (vim) syntax into
// javascript form.  Similar to translateRegex, but additionally fixes back references
// (translates '\[0..9]' to '$[0..9]') and follows different rules for escaping '$'.
const charUnescapes: Record<string, string> = {
  "\\n": "\n",
  "\\r": "\r",
  "\\t": "\t",
}
export function translateRegexReplace(str: string) {
  let escapeNextChar = false
  const out: string[] = []
  for (let i = -1; i < str.length; i++) {
    const c = str.charAt(i) || ""
    const n = str.charAt(i + 1) || ""
    if (charUnescapes[c + n]) {
      out.push(charUnescapes[c + n])
      i++
    } else if (escapeNextChar) {
      // At any point in the loop, escapeNextChar is true if the previous
      // character was a '\' and was not escaped.
      out.push(c)
      escapeNextChar = false
    } else {
      if (c === "\\") {
        escapeNextChar = true
        if (isNumber(n) || n === "$") {
          out.push("$")
        } else if (n !== "/" && n !== "\\") {
          out.push("\\")
        }
      } else {
        if (c === "$") {
          out.push("$")
        }
        out.push(c)
        if (n === "/") {
          out.push("\\")
        }
      }
    }
  }
  return out.join("")
}

// Unescape \ and / in the replace part, for PCRE mode.
const unescapes: Record<string, string> = {
  "\\/": "/",
  "\\\\": "\\",
  "\\n": "\n",
  "\\r": "\r",
  "\\t": "\t",
  "\\&": "&",
}
export function unescapeRegexReplace(str: string) {
  const stream = new StringStream(str)
  const output: string[] = []
  while (!stream.eol()) {
    // Search for \.
    while (stream.peek() && stream.peek() !== "\\") {
      output.push(stream.next()!)
    }
    let matched = false
    for (const matcher in unescapes) {
      if (stream.match(matcher, true)) {
        matched = true
        output.push(unescapes[matcher])
        break
      }
    }
    if (!matched) {
      // Don't change anything
      output.push(stream.next()!)
    }
  }
  return output.join("")
}

/**
 * Extract the regular expression from the query and return a Regexp object.
 * Returns null if the query is blank.
 * If ignoreCase is passed in, the Regexp object will have the 'i' flag set.
 * If smartCase is passed in, and the query contains upper case letters,
 *   then ignoreCase is overridden, and the 'i' flag will not be set.
 * If the query contains the /i in the flag part of the regular expression,
 *   then both ignoreCase and smartCase are ignored, and 'i' will be passed
 *   through to the Regex object.
 */
function parseQuery(query: string | RegExp, ignoreCase: boolean, smartCase: boolean) {
  // First update the last search register
  const lastSearchRegister = vimGlobalState.registerController.getRegister("/")
  lastSearchRegister.setText(typeof query === "string" ? query : query.source)
  // Check if the query is already a regex.
  if (query instanceof RegExp) {
    return query
  }
  // First try to extract regex + flags from the input. If no flags found,
  // extract just the regex. IE does not accept flags directly defined in
  // the regex string in the form /regex/flags
  const slashes = findUnescapedSlashes(query)
  let regexPart: string
  let forceIgnoreCase: boolean | undefined
  if (!slashes.length) {
    // Query looks like 'regexp'
    regexPart = query
  } else {
    // Query looks like 'regexp/...'
    regexPart = query.substring(0, slashes[0])
    const flagsPart = query.substring(slashes[0])
    forceIgnoreCase = flagsPart.includes("i")
  }
  if (!regexPart) {
    return null
  }
  if (!getOption("pcre")) {
    regexPart = translateRegex(regexPart)
  }
  if (smartCase) {
    ignoreCase = /^[^A-Z]*$/.test(regexPart)
  }
  return new RegExp(regexPart, ignoreCase || forceIgnoreCase ? "im" : "m")
}

export function showConfirm(adapter: EditorAdapter, template: string) {
  adapter.openNotification(template)
}

interface PromptOptions extends StatusBarInputOptions {
  prefix: string
  desc?: string
  onClose: (value: string) => void
}

export function showPrompt(adapter: EditorAdapter, options: PromptOptions) {
  adapter.openPrompt(options.prefix, options.desc || "", {
    onKeyDown: options.onKeyDown,
    onKeyUp: options.onKeyUp,
    onClose: options.onClose,
    selectValueOnOpen: false,
    value: options.value,
  })
}

function regexEqual(r1: RegExp | string, r2: RegExp | string) {
  if (r1 instanceof RegExp && r2 instanceof RegExp) {
    return (
      r1.global === r2.global &&
      r1.multiline === r2.multiline &&
      r1.ignoreCase === r2.ignoreCase &&
      r1.source === r2.source
    )
  }
  return false
}

// Returns true if the query is valid.
export function updateSearchQuery(
  adapter: EditorAdapter,
  rawQuery?: string,
  ignoreCase?: boolean,
  smartCase?: boolean,
) {
  if (!rawQuery) {
    return
  }
  const state = getSearchState(adapter)
  if (!state) {
    return
  }
  const query = parseQuery(rawQuery, !!ignoreCase, !!smartCase)
  if (!query) {
    return
  }
  highlightSearchMatches(adapter, query)
  if (regexEqual(query, state.getQuery()!)) {
    return query
  }
  state.setQuery(query)
  return query
}

let _highlightTimeout: ReturnType<typeof setTimeout> | undefined

export function highlightSearchMatches(adapter: EditorAdapter, query: RegExp) {
  clearTimeout(_highlightTimeout)
  _highlightTimeout = setTimeout(() => {
    if (!adapter.state.vim) return
    const searchState = getSearchState(adapter)
    if (!searchState) return
    let overlay = searchState.getOverlay()
    if (!overlay || query !== overlay.query) {
      if (overlay) {
        adapter.removeOverlay()
      }
      overlay = searchOverlay(query)
      adapter.addOverlay(overlay.query)
      searchState.setOverlay(overlay)
    }
  }, 50)
}

export function cancelPendingHighlight() {
  clearTimeout(_highlightTimeout)
  _highlightTimeout = undefined
}

export function findNext(adapter: EditorAdapter, prev: boolean, query: RegExp, repeat?: number) {
  if (repeat === undefined) {
    repeat = 1
  }
  const pos = adapter.getCursor()
  let cursor = adapter.getSearchCursor(query, pos)
  for (let i = 0; i < repeat; i++) {
    let found = cursor.find(prev)
    const firstFrom = cursor.from()
    if (i === 0 && found && firstFrom && cursorEqual(firstFrom, pos)) {
      const lastEndPos = prev ? cursor.from() : cursor.to()
      found = cursor.find(prev)
      const repeatedFrom = cursor.from()
      if (found && lastEndPos && repeatedFrom && cursorEqual(repeatedFrom, lastEndPos)) {
        if (adapter.getLine(lastEndPos.line).length === lastEndPos.ch) {
          found = cursor.find(prev)
        }
      }
    }
    if (!found) {
      // SearchCursor may have returned null because it hit EOF, wrap
      // around and try again.
      cursor = adapter.getSearchCursor(query, makePos(prev ? adapter.lastLine() : adapter.firstLine(), 0))
      if (!cursor.find(prev)) {
        return
      }
    }
  }
  return cursor.from()
}

export function clearSearchHighlight(adapter: EditorAdapter) {
  const state = getSearchState(adapter)
  if (!state) {
    adapter.removeOverlay()
    return
  }
  adapter.removeOverlay()
  state.setOverlay(undefined)
  if (state.getScrollbarAnnotate()) {
    state.getScrollbarAnnotate().clear()
    state.setScrollbarAnnotate(null)
  }
}

/**
 * Check if pos is in the specified range, INCLUSIVE.
 * Range can be specified with 1 or 2 arguments.
 * If the first range argument is an array, treat it as an array of line
 * numbers. Match pos against any of the lines.
 * If the first range argument is a number,
 *   if there is only 1 range argument, check if pos has the same line number
 *   if there are 2 range arguments, then check if pos is in between the two
 *       range arguments.
 */
export function isInRange(pos: Pos | number, start: number | number[], end?: number) {
  if (isPos(pos)) {
    pos = pos.line
  }
  if (Array.isArray(start)) {
    return inArray(pos, start)
  } else {
    if (typeof end === "number") {
      return pos >= start && pos <= end
    } else {
      return pos === start
    }
  }
}
