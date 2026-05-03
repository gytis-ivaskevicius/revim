import { describe, expect, test } from "bun:test"
import { initLog } from "../../src/log"

describe("initLog path validation", () => {
  test("initLog('/etc/passwd') throws because path does not end in .log", () => {
    expect(() => initLog("/etc/passwd")).toThrow(/\.log/)
  })

  test("initLog('../../../etc/passwd.log') throws because path contains ..", () => {
    expect(() => initLog("../../../etc/passwd.log")).toThrow(/\.\./)
  })
})
