export type Snapshot = {
  updatedAt: number
  cwd: string
  branch?: string
  gitExtras?: string
  env?: string
  version?: string
  model?: string
  startedAt?: number
  plan?: string
  email?: string
  context: { tokens?: number; window: number; percent?: number }
  tokens?: { input: number; output: number; cached: number; total: number }
  fiveHour?: { percent: number; resetsAt?: string }
  sevenDay?: { percent: number; resetsAt?: string }
  costUsd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'status-panel': { snapshot: Snapshot | null; effort: string | null; shown: boolean }
  }
}
