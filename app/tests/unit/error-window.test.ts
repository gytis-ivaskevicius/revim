import { describe, expect, test } from "bun:test"
import { createErrorWindow } from "../../src/error-window"

describe("createErrorWindow", () => {
  test("10 rapid errors triggers shutdown signal", () => {
    let fakeNow = 1000
    const now = () => fakeNow
    const window = createErrorWindow(10, 30000, now)

    for (let i = 0; i < 9; i++) {
      expect(window.record()).toBe(false)
      fakeNow += 1
    }
    // 10th error within the window should trip
    expect(window.record()).toBe(true)
  })

  test("5 errors + 31s wait + 5 errors does NOT trigger shutdown", () => {
    let fakeNow = 1000
    const now = () => fakeNow
    const window = createErrorWindow(10, 30000, now)

    // 5 errors, 1ms apart
    for (let i = 0; i < 5; i++) {
      expect(window.record()).toBe(false)
      fakeNow += 1
    }

    // Wait 31 seconds — errors should have expired
    fakeNow += 31000

    // 5 more errors
    for (let i = 0; i < 5; i++) {
      expect(window.record()).toBe(false)
      fakeNow += 1
    }
  })

  test("normal operation with no errors is unaffected", () => {
    const window = createErrorWindow(10, 30000)
    // No errors recorded — nothing to assert, just shouldn't throw
    expect(window).toBeDefined()
  })
})
