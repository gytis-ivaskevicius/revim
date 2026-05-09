export interface ErrorWindow {
  record(): boolean
}

export function createErrorWindow(limit: number, windowMs: number, now?: () => number): ErrorWindow {
  const _now = now || Date.now
  const timestamps: number[] = []
  return {
    record(): boolean {
      const t = _now()
      timestamps.push(t)
      const cutoff = t - windowMs
      // Remove entries outside the window
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift()
      }
      return timestamps.length >= limit
    },
  }
}
