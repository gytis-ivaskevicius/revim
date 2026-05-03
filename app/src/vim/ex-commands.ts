import EditorAdapter from "./adapter"
import { commandDispatcher } from "./command-dispatcher"
import {
  copyCursor,
  cursorEqual,
  getEventKeyName,
  isLowerCase,
  isUpperCase,
  makePos,
  type Pos,
  stopEvent,
} from "./common"
import { ExCommandDispatcher } from "./ex-command-dispatcher"
import { vimGlobalState } from "./global"
import { getOption, getOptionType, type OptionConfig, setOption } from "./options"
import { Register } from "./register-controller"
import { getSearchState } from "./search"
import {
  clearSearchHighlight,
  isInRange,
  showConfirm,
  showPrompt,
  splitBySeparator,
  splitBySlash,
  translateRegexReplace,
  unescapeRegexReplace,
  updateSearchQuery,
} from "./search-utils"
import { StringStream } from "./string-stream"
import type { Context, VimState } from "./types"
import { PACKAGE_INFO } from "./version"
import { clipCursorToContent, lineLength, trim } from "./vim-utils"

export interface ExCommandOptionalParameters {
  callback?: () => void
  input?: string
  commandName?: string
  line?: number
  lineEnd?: number
  argString?: string
  args?: string[]
}

interface ExCommandParams extends ExCommandOptionalParameters {
  input: string
  setCfg?: OptionConfig
}

export type ExCommandFunc = (adapter: EditorAdapter, params: ExCommandParams, ctx?: Context) => void

export const exCommandDispatcher = new ExCommandDispatcher()

/**
 * @param {EditorAdapter} adapter EditorAdapter instance we are in.
 * @param {boolean} confirm Whether to confirm each replace.
 * @param {Cursor} lineStart Line to start replacing from.
 * @param {Cursor} lineEnd Line to stop replacing at.
 * @param {RegExp} query Query for performing matches with.
 * @param {string} replaceWith Text to replace matches with. May contain $1,
 *     $2, etc for replacing captured groups using JavaScript replace.
 * @param {function()} callback A callback for when the replace is done.
 */
function doReplace(
  adapter: EditorAdapter,
  confirm: boolean,
  global: boolean,
  lineStart: number,
  lineEnd: number,
  searchCursor: ReturnType<InstanceType<typeof EditorAdapter>["getSearchCursor"]>,
  query: RegExp,
  replaceWith: string,
  callback?: () => void,
) {
  const vim = adapter.state.vim as VimState
  // Set up all the functions.
  vim.exMode = true

  let done = false
  let lastPos: Pos
  let modifiedLineNumber: number
  let joined: boolean
  const replaceAll = () => {
    while (!done) {
      replace()
      next()
    }
    stop()
  }
  const replace = () => {
    const from = searchCursor.from()
    const to = searchCursor.to()
    if (!from || !to) {
      done = true
      return
    }
    const text = adapter.getRange(from, to)
    const newText = text.replace(query, replaceWith)
    const unmodifiedLineNumber = to.line
    searchCursor.replace(newText)
    const replacedTo = searchCursor.to()
    if (!replacedTo) {
      done = true
      return
    }
    modifiedLineNumber = replacedTo.line
    lineEnd += modifiedLineNumber - unmodifiedLineNumber
    joined = modifiedLineNumber < unmodifiedLineNumber
  }
  const findNextValidMatch = () => {
    const currentTo = searchCursor.to()
    const lastMatchTo = lastPos && currentTo ? copyCursor(currentTo) : undefined
    let match = searchCursor.findNext()
    const nextFrom = searchCursor.from()
    if (match && lastMatchTo && nextFrom && cursorEqual(nextFrom, lastMatchTo)) {
      match = searchCursor.findNext()
    }
    return match
  }
  const next = () => {
    // The below only loops to skip over multiple occurrences on the same
    // line when 'global' is not true.
    while (findNextValidMatch()) {
      const matchFrom = searchCursor.from()
      const matchTo = searchCursor.to()
      if (!matchFrom || !matchTo) {
        done = true
        return
      }
      if (!isInRange(matchFrom, lineStart, lineEnd)) {
        break
      }
      if (!global && matchFrom.line === modifiedLineNumber && !joined) {
        continue
      }
      adapter.scrollIntoView(matchFrom)
      adapter.setSelection(matchFrom, matchTo)
      lastPos = matchFrom
      done = false
      return
    }
    done = true
  }
  const stop = () => {
    adapter.focus()
    if (lastPos) {
      adapter.setCursor(lastPos)
      const vim = adapter.state.vim as VimState
      vim.exMode = false
      vim.lastHPos = vim.lastHSPos = lastPos.ch
    }
    if (callback) {
      callback()
    }
  }
  const onPromptKeyDown = (
    e: import("./statusbar").StatusBarKeyEvent,
    _value: string,
    _setQuery: (value: string) => void,
  ) => {
    // Swallow all keys.
    stopEvent(e)
    const keyName = getEventKeyName(e)
    switch (keyName) {
      case "Y":
        replace()
        next()
        break
      case "N":
        next()
        break
      case "A": {
        // replaceAll performs all replacements at once. Save/restore callback
        // to prevent it from firing early during batch replacement.
        const savedCallback = callback
        callback = undefined
        replaceAll()
        callback = savedCallback
        break
      }
      // biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional fallthrough to finalize
      case "L":
        replace()
      // fall through and exit.
      case "Q":
      case "Esc":
      case "Ctrl-C":
      case "Ctrl-[":
        stop()
        break
    }
    if (done) {
      stop()
    }
    return true
  }

  // Actually do replace.
  next()
  if (done) {
    showConfirm(adapter, `No matches for ${query.source}`)
    return
  }
  if (!confirm) {
    replaceAll()
    if (callback) {
      callback()
    }
    return
  }
  showPrompt(adapter, {
    prefix: `replace with **${replaceWith}** (y/n/a/q/l)`,
    onKeyDown: onPromptKeyDown,
    desc: "",
    onClose: () => {},
  })
}

export const exCommands: Record<string, ExCommandFunc> = {
  colorscheme: (adapter, params) => {
    if (!params.args || params.args.length < 1) {
      showConfirm(adapter, adapter.getOption("theme"))
      return
    }
    adapter.setOption("theme", params.args[0])
  },
  map: (adapter, params, ctx) => {
    const mapArgs = params.args
    if (!mapArgs || mapArgs.length < 2) {
      if (adapter) {
        showConfirm(adapter, `Invalid mapping: ${params.input}`)
      }
      return
    }
    exCommandDispatcher.map(mapArgs[0], mapArgs[1], ctx)
  },
  imap: function (adapter, params) {
    this.map(adapter, params, "insert")
  },
  nmap: function (adapter, params) {
    this.map(adapter, params, "normal")
  },
  vmap: function (adapter, params) {
    this.map(adapter, params, "visual")
  },
  unmap: (adapter, params, ctx) => {
    const mapArgs = params.args
    if (!mapArgs || mapArgs.length < 1 || !exCommandDispatcher.unmap(mapArgs[0], ctx)) {
      if (adapter) {
        showConfirm(adapter, `No such mapping: ${params.input}`)
      }
    }
  },
  move: (adapter, params) => {
    commandDispatcher.processCommand(adapter, adapter.state.vim, {
      keys: "",
      type: "motion",
      motion: "moveToLineOrEdgeOfDocument",
      motionArgs: { forward: false, explicitRepeat: true, linewise: true },
      repeatOverride: params.line! + 1,
    })
  },
  set: (adapter, params) => {
    const setArgs = params.args
    // Options passed through to the setOption/getOption calls. May be passed in by the
    // local/global versions of the set command
    const setCfg = params.setCfg || {}
    if (!setArgs || setArgs.length < 1) {
      if (adapter) {
        showConfirm(adapter, `Invalid mapping: ${params.input}`)
      }
      return
    }
    const expr = setArgs[0].split("=")
    let optionName = expr[0]
    let value: string | boolean = expr[1]
    let forceGet = false

    if (optionName.endsWith("?")) {
      // If post-fixed with ?, then the set is actually a get.
      if (value) {
        throw Error(`Trailing characters: ${params.argString}`)
      }
      optionName = optionName.substring(0, optionName.length - 1)
      forceGet = true
    } else if (optionName.endsWith("-")) {
      optionName = optionName.substring(0, optionName.length - 1)
      setCfg.remove = true
    } else if (optionName.endsWith("+")) {
      optionName = optionName.substring(0, optionName.length - 1)
      setCfg.append = true
    }
    if (value === undefined && optionName.substring(0, 2) === "no") {
      // To set boolean options to false, the option name is prefixed with
      // 'no'.
      optionName = optionName.substring(2)
      value = false
    }

    const optionIsBoolean = getOptionType(optionName) === "boolean"
    if (optionIsBoolean && value === undefined) {
      // Calling set with a boolean option sets it to true.
      value = true
    }
    // If no value is provided, then we assume this is a get.
    if ((!optionIsBoolean && value === undefined) || forceGet) {
      const oldValue = getOption(optionName, adapter, setCfg)
      if (oldValue instanceof Error) {
        showConfirm(adapter, oldValue.message)
      } else if (oldValue === true || oldValue === false) {
        showConfirm(adapter, `${oldValue ? "" : "no"}${optionName}`)
      } else {
        showConfirm(adapter, `${optionName}=${oldValue}`)
      }
    } else {
      const setOptionReturn = setOption(optionName, value, adapter, setCfg)
      if (setOptionReturn instanceof Error) {
        showConfirm(adapter, setOptionReturn.message)
      }
    }
  },
  setlocal: function (adapter, params) {
    // setCfg is passed through to setOption
    params.setCfg = { scope: "local" }
    this.set(adapter, params)
  },
  setglobal: function (adapter, params) {
    // setCfg is passed through to setOption
    params.setCfg = { scope: "global" }
    this.set(adapter, params)
  },
  registers: (adapter, params) => {
    const regArgs = params.args
    const registers = vimGlobalState.registerController.registers
    const regInfo = ["----------Registers----------", ""]
    if (!regArgs) {
      for (const registerName in registers) {
        const text = registers[registerName].toString()
        if (text.length) {
          regInfo.push(`"${registerName}"     ${text}`)
        }
      }
    } else {
      const reglist = regArgs.join("")
      for (let i = 0; i < reglist.length; i++) {
        const registerName = reglist.charAt(i)
        if (!vimGlobalState.registerController.isValidRegister(registerName)) {
          continue
        }
        const register = registers[registerName] || new Register()
        regInfo.push(`"#{registerName}"     ${register.toString()}`)
      }
    }
    showConfirm(adapter, regInfo.join("\n"))
  },
  sort: (adapter, params) => {
    let reverse: boolean | undefined
    let ignoreCase: boolean | undefined
    let unique: boolean | undefined
    let number: "decimal" | "hex" | "octal" | undefined
    let pattern: RegExp | undefined
    const parseArgs = () => {
      if (params.argString) {
        const args = new StringStream(params.argString)
        if (args.eat("!")) {
          reverse = true
        }
        if (args.eol()) {
          return
        }
        if (!args.eatSpace()) {
          return "Invalid arguments"
        }
        const opts = args.match(/([dinuox]+)?\s*(\/.+\/)?\s*/, false)
        if (!opts && !args.eol()) {
          return "Invalid arguments"
        }
        if (opts[1]) {
          ignoreCase = opts[1].indexOf("i") !== -1
          unique = opts[1].indexOf("u") !== -1
          const decimal = opts[1].indexOf("d") !== -1 || opts[1].indexOf("n") !== -1 ? 1 : 0
          const hex = opts[1].indexOf("x") !== -1 ? 1 : 0
          const octal = opts[1].indexOf("o") !== -1 ? 1 : 0
          if (decimal + hex + octal > 1) {
            return "Invalid arguments"
          }
          number = decimal ? "decimal" : hex ? "hex" : octal ? "octal" : undefined
        }
        if (opts[2]) {
          pattern = new RegExp(opts[2].substring(1, opts[2].length - 1), ignoreCase ? "i" : "")
        }
      }
    }
    const err = parseArgs()
    if (err) {
      showConfirm(adapter, `${err}: ${params.argString}`)
      return
    }
    const lineStart = params.line || adapter.firstLine()
    const lineEnd = params.lineEnd || params.line || adapter.lastLine()
    if (lineStart === lineEnd) {
      return
    }
    const curStart = makePos(lineStart, 0)
    const curEnd = makePos(lineEnd, lineLength(adapter, lineEnd))
    const text = adapter.getRange(curStart, curEnd).split("\n")
    const numberRegex = pattern
      ? pattern
      : number === "decimal" || number === undefined
        ? /(-?)([\d]+)/
        : number === "hex"
          ? /(-?)(?:0x)?([0-9a-f]+)/i
          : /([0-7]+)/
    const radix = number === "decimal" || number === undefined ? 10 : number === "hex" ? 16 : 8
    const numPart: (RegExpMatchArray | string)[] = []
    const textPart: string[] = []
    if (number || pattern) {
      for (let i = 0; i < text.length; i++) {
        const matchPart = pattern ? text[i].match(pattern) : null
        if (matchPart && matchPart[0] !== "") {
          numPart.push(matchPart)
        } else if (!pattern && numberRegex.exec(text[i])) {
          numPart.push(text[i])
        } else {
          textPart.push(text[i])
        }
      }
    } else {
      textPart.push(...text)
    }
    const compareFn = (a: string, b: string) => {
      if (reverse) {
        const tmp = a
        a = b
        b = tmp
      }
      if (ignoreCase) {
        a = a.toLowerCase()
        b = b.toLowerCase()
      }
      const anum = number && numberRegex.exec(a)
      const bnum = number && numberRegex.exec(b)
      if (!anum || !bnum) {
        return a < b ? -1 : 1
      }
      return parseInt((anum[1] + anum[2]).toLowerCase(), radix) - parseInt((bnum[1] + bnum[2]).toLowerCase(), radix)
    }
    const comparePatternFn = (a: string, b: string) => {
      if (reverse) {
        const tmp = a
        a = b
        b = tmp
      }
      if (ignoreCase) {
        return a[0].toLowerCase() < b[0].toLowerCase() ? -1 : 1
      } else {
        return a[0] < b[0] ? -1 : 1
      }
    }
    ;(numPart as string[]).sort(pattern ? comparePatternFn : compareFn)
    if (pattern) {
      for (let i = 0; i < numPart.length; i++) {
        const np = numPart[i]
        if (typeof np !== "string") {
          numPart[i] = np.input!
        }
      }
    } else if (!number) {
      textPart.sort(compareFn)
    }
    text.splice(0, text.length)
    if (!reverse) {
      text.push(...textPart)
      text.push(...numPart.map((el) => (typeof el === "string" ? el : el.toString())))
    } else {
      text.push(...numPart.map((el) => (typeof el === "string" ? el : el.toString())))
      text.push(...textPart)
    }
    if (unique) {
      // Remove duplicate lines
      let lastLine = ""
      for (let i = text.length - 1; i >= 0; i--) {
        if (text[i] === lastLine) {
          text.splice(i, 1)
        } else {
          lastLine = text[i]
        }
      }
    }
    adapter.replaceRange(text.join("\n"), curStart, curEnd)
  },
  vglobal: function (adapter, params) {
    // global inspects params.commandName
    this.global(adapter, params)
  },
  global: (adapter, params) => {
    // a global command is of the form
    // :[range]g/pattern/[cmd]
    // argString holds the string /pattern/[cmd]
    const argString = params.argString
    if (!argString) {
      showConfirm(adapter, "Regular Expression missing from global")
      return
    }
    const inverted = params.commandName?.[0] === "v"
    // range is specified here
    const lineStart = params.line !== undefined ? params.line : adapter.firstLine()
    const lineEnd = params.lineEnd || params.line || adapter.lastLine()
    // get the tokens from argString
    const tokens = splitBySlash(argString)
    let regexPart = argString
    let cmd: string | undefined
    if (tokens?.length) {
      regexPart = tokens[0]
      cmd = tokens.slice(1, tokens.length).join("/")
    }
    if (regexPart) {
      // If regex part is empty, then use the previous query. Otherwise
      // use the regex part as the new query.
      try {
        updateSearchQuery(adapter, regexPart, true /** ignoreCase */, true /** smartCase */)
      } catch (_e) {
        showConfirm(adapter, `Invalid regex: ${regexPart}`)
        return
      }
    }
    // now that we have the regexPart, search for regex matches in the
    // specified range of lines
    const searchState = getSearchState(adapter)
    if (!searchState) return
    const query = searchState.getQuery()!
    const matchedLines: { line: number; text: string }[] = []
    for (let i = lineStart; i <= lineEnd; i++) {
      const line = adapter.getLine(i)
      const matched = query.test(line)
      if (matched !== inverted) {
        matchedLines.push({ line: i, text: line })
      }
    }
    // if there is no [cmd], just display the list of matched lines
    if (!cmd) {
      showConfirm(adapter, matchedLines.map((el) => el.text).join("\n"))
      return
    }
    let index = 0
    const nextCommand = () => {
      if (index < matchedLines.length) {
        const line = matchedLines[index++]
        const command = `${line.line + 1}${cmd}`
        exCommandDispatcher.processCommand(adapter, command, {
          callback: nextCommand,
        })
      }
    }
    nextCommand()
  },
  substitute: (adapter, params) => {
    if (!adapter.getSearchCursor) {
      throw new Error(
        "Search feature not available. Requires searchcursor.js or " + "any other getSearchCursor implementation.",
      )
    }
    const argString = params.argString
    const tokens = argString ? splitBySeparator(argString, argString[0]) : []
    let regexPart: string | undefined
    let replacePart: string | undefined = ""
    let trailing: string[] | undefined
    let count: number | undefined
    let confirm = false // Whether to confirm each replace.
    let global = false // True to replace all instances on a line, false to replace only 1.
    if (tokens?.length) {
      regexPart = tokens[0]
      if (getOption("pcre") && regexPart !== "") {
        regexPart = new RegExp(regexPart).source //normalize not escaped characters
      }
      replacePart = tokens[1]
      if (replacePart !== undefined) {
        if (getOption("pcre")) {
          replacePart = unescapeRegexReplace(replacePart.replace(/([^\\])&/g, "$1$$&"))
        } else {
          replacePart = translateRegexReplace(replacePart)
        }
        vimGlobalState.lastSubstituteReplacePart = replacePart
      }
      trailing = tokens[2] ? tokens[2].split(" ") : []
    } else {
      // either the argString is empty or its of the form ' hello/world'
      // actually splitBySlash returns a list of tokens
      // only if the string starts with a '/'
      if (argString?.length) {
        showConfirm(adapter, "Substitutions should be of the form " + ":s/pattern/replace/")
        return
      }
    }
    // After the 3rd slash, we can have flags followed by a space followed
    // by count.
    if (trailing) {
      const flagsPart = trailing[0]
      count = parseInt(trailing[1], 10)
      if (flagsPart) {
        if (flagsPart.includes("c")) {
          confirm = true
        }
        if (flagsPart.includes("g")) {
          global = true
        }
        if (getOption("pcre")) {
          regexPart = `${regexPart!}/${flagsPart}`
        } else {
          regexPart = `${regexPart?.replace(/\//g, "\\/")}/${flagsPart}`
        }
      }
    }
    if (regexPart) {
      // If regex part is empty, then use the previous query. Otherwise use
      // the regex part as the new query.
      try {
        updateSearchQuery(adapter, regexPart, true /** ignoreCase */, true /** smartCase */)
      } catch (_e) {
        showConfirm(adapter, `Invalid regex: ${regexPart}`)
        return
      }
    }
    replacePart = replacePart || vimGlobalState.lastSubstituteReplacePart
    if (replacePart === undefined) {
      showConfirm(adapter, "No previous substitute regular expression")
      return
    }
    const state = getSearchState(adapter)
    if (!state) {
      showConfirm(adapter, "No previous search query")
      return
    }
    const query = state.getQuery()!
    let lineStart = params.line !== undefined ? params.line : adapter.getCursor().line
    let lineEnd = params.lineEnd || lineStart
    if (lineStart === adapter.firstLine() && lineEnd === adapter.lastLine()) {
      lineEnd = Infinity
    }
    if (count) {
      lineStart = lineEnd
      lineEnd = lineStart + count - 1
    }
    const startPos = clipCursorToContent(adapter, makePos(lineStart, 0))
    const cursor = adapter.getSearchCursor(query, startPos)
    adapter.pushUndoStop()
    doReplace(adapter, confirm, global, lineStart, lineEnd, cursor, query, replacePart, params.callback)
  },
  redo: EditorAdapter.commands.redo,
  undo: EditorAdapter.commands.undo,
  edit: (adapter, params) => {
    if (EditorAdapter.commands.open) {
      // If an open command is defined, call it.
      EditorAdapter.commands.open(adapter, params)
    }
  },
  save: (adapter, params) => {
    if (!params.args || params.args.length !== 1) {
      showConfirm(adapter, `save requires a single argument`)
      return
    } else {
      params.argString = params.args[0]
    }
    if (EditorAdapter.commands.save) {
      // If a save command is defined, call it.
      EditorAdapter.commands.save(adapter, params)
    }
  },
  version: (adapter) => {
    const versionInfo: string[] = []
    versionInfo.push(`${PACKAGE_INFO.name} v${PACKAGE_INFO.version}`)
    showConfirm(adapter, versionInfo.join("\n"))
  },
  write: (adapter, params) => {
    if (EditorAdapter.commands.save) {
      // If a save command is defined, call it.
      EditorAdapter.commands.save(adapter, params)
    }
  },
  nohlsearch: (adapter) => {
    clearSearchHighlight(adapter)
  },
  yank: (adapter) => {
    const cur = copyCursor(adapter.getCursor())
    const line = cur.line
    const lineText = adapter.getLine(line)
    vimGlobalState.registerController.pushText("0", "yank", lineText, true, true)
  },
  delmarks: (adapter, params) => {
    if (!params.argString || !trim(params.argString)) {
      showConfirm(adapter, "Argument required")
      return
    }

    const state = adapter.state.vim as VimState
    const stream = new StringStream(trim(params.argString))
    while (!stream.eol()) {
      stream.eatSpace()

      // Record the streams position at the beginning of the loop for use
      // in error messages.
      const count = stream.pos

      if (!stream.match(/[a-zA-Z]/, false)) {
        showConfirm(adapter, `Invalid argument: ${params.argString.substring(count)}`)
        return
      }

      const sym = stream.next()
      // Check if this symbol is part of a range
      if (stream.match("-", true)) {
        // This symbol is part of a range.

        // The range must terminate at an alphabetic character.
        if (!stream.match(/[a-zA-Z]/, false)) {
          showConfirm(adapter, `Invalid argument: ${params.argString.substring(count)}`)
          return
        }

        const startMark = sym!
        const finishMark = stream.next()!
        // The range must terminate at an alphabetic character which
        // shares the same case as the start of the range.
        if (
          (isLowerCase(startMark) && isLowerCase(finishMark)) ||
          (isUpperCase(startMark) && isUpperCase(finishMark))
        ) {
          const start = startMark.charCodeAt(0)
          const finish = finishMark.charCodeAt(0)
          if (start >= finish) {
            showConfirm(adapter, `Invalid argument: ${params.argString.substring(count)}`)
            return
          }

          // Because marks are always ASCII values, and we have
          // determined that they are the same case, we can use
          // their char codes to iterate through the defined range.
          for (let j = 0; j <= finish - start; j++) {
            const mark = String.fromCharCode(start + j)
            delete state.marks[mark]
          }
        } else {
          showConfirm(adapter, `Invalid argument: ${startMark}-`)
          return
        }
      } else {
        // This symbol is a valid mark, and is not part of a range.
        delete state.marks[sym!]
      }
    }
  },
}
