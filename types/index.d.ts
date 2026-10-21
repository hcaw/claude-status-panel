export type Snapshot = {
  updatedAt: number
  cwd: string
  branch?: string
  version?: string
  model?: string
  startedAt?: number
  plan?: string
  email?: string
  context: { tokens?: number; window: number; percent?: number }
  fiveHour?: { percent: number; resetsAt?: string }
  sevenDay?: { percent: number; resetsAt?: string }
  costUsd?: number
}

// `cached` is cache reads and writes together; `cacheRead` the reads alone, absent in
// totals kept before it was counted.
export type Tokens = { input: number; output: number; cached: number; cacheRead?: number; total: number }

// Per main-loop response, oldest first and capped: the context it was answered over
// (input, cache reads and cache writes) and the tokens it generated.
export type History = { context: number[]; output: number[] }

declare module 'claude-code' {
  interface PluginState {
    'status-panel': {
      snapshot: Snapshot | null
      effort: string | null
      shown: boolean
      tokens: Tokens | null
      history: History | null
      tab: string
      helpTopic: string | null
      hoverHelp: boolean
      refreshSecs: number
    }
  }
}
