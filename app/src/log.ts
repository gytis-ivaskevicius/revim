import { closeSync, openSync, writeSync } from "node:fs"
import { clearLogFd, setLogFd } from "@revim/lib"

let logFd: number | null = null

export function initLog(path: string): void {
  if (!path.endsWith(".log")) {
    throw new Error(`Log path must end with .log extension: ${path}`)
  }
  // Check for path-segment ".." (traversal), not substring ".." (which would reject legitimate names like "foo..bar.log")
  if (path.split(/[/\\]/).includes("..")) {
    throw new Error(`Log path must not contain path traversal (..): ${path}`)
  }
  logFd = openSync(path, "w")
  setLogFd(logFd)
}

export function closeLog(): void {
  if (logFd === null) {
    return
  }
  closeSync(logFd)
  clearLogFd()
  logFd = null
}

export function log(...args: unknown[]): void {
  if (logFd === null) {
    return
  }
  const message = args.map((arg) => String(arg)).join(" ")
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] [TS] ${message}\n`
  writeSync(logFd, line)
}
