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

export type Tokens = { input: number; output: number; cached: number; total: number }

declare module 'claude-code' {
  interface PluginState {
    'status-panel': {
      snapshot: Snapshot | null
      effort: string | null
      shown: boolean
      tokens: Tokens | null
    }
  }
}
