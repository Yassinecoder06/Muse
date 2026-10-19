import vm from 'node:vm'

export interface SandboxExecutionResult {
  success: boolean
  result?: any
  logs: string[]
  error?: string
  executionTimeMs: number
}

export function executeInSandbox(code: string, timeoutMs = 2500): SandboxExecutionResult {
  const logs: string[] = []
  const startTime = Date.now()

  // Guard against forbidden references and environment access
  const forbidden = [
    /\bprocess\b/,
    /\brequire\b/,
    /\bimport\b/,
    /\bchild_process\b/,
    /\bfs\b/,
    /\bnet\b/,
    /\bhttp\b/,
    /\bhttps\b/,
    /\b__proto__\b/
  ]

  for (const pattern of forbidden) {
    if (pattern.test(code)) {
      return {
        success: false,
        logs: [],
        error: `Security violation: Forbidden keyword or identifier detected matching ${pattern}.`,
        executionTimeMs: 0
      }
    }
  }

  const fakeConsole = {
    log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    error: (...args: any[]) => logs.push('[error] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    warn: (...args: any[]) => logs.push('[warn] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
    info: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
  }

  // Math, statistics & utility kit for data analysis and algorithmic computation
  const sandboxScope = {
    console: fakeConsole,
    Math,
    Date,
    JSON,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    Map,
    Set,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    // Statistical & Array Helpers
    sum: (arr: number[]) => (Array.isArray(arr) ? arr.reduce((acc, v) => acc + (Number(v) || 0), 0) : 0),
    avg: (arr: number[]) => (Array.isArray(arr) && arr.length > 0 ? arr.reduce((acc, v) => acc + (Number(v) || 0), 0) / arr.length : 0),
    mean: (arr: number[]) => (Array.isArray(arr) && arr.length > 0 ? arr.reduce((acc, v) => acc + (Number(v) || 0), 0) / arr.length : 0),
    median: (arr: number[]) => {
      if (!Array.isArray(arr) || arr.length === 0) return 0
      const sorted = [...arr].map(Number).sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    },
    stddev: (arr: number[]) => {
      if (!Array.isArray(arr) || arr.length <= 1) return 0
      const nums = arr.map(Number)
      const m = nums.reduce((a, b) => a + b, 0) / nums.length
      const variance = nums.reduce((acc, v) => acc + (v - m) ** 2, 0) / (nums.length - 1)
      return Math.sqrt(variance)
    },
    range: (start: number, end: number, step = 1) => {
      const res: number[] = []
      if (step <= 0) return res
      for (let i = start; i < end; i += step) res.push(i)
      return res
    },
    roundTo: (num: number, decimals = 2) => {
      const factor = 10 ** decimals
      return Math.round((Number(num) || 0) * factor) / factor
    },
    percent: (val: number, total: number) => {
      if (!total) return 0
      return Math.round(((Number(val) || 0) / Number(total)) * 10000) / 100
    },
    factorial: (n: number): number => {
      let num = Math.floor(Number(n) || 0)
      if (num <= 1) return 1
      if (num > 170) return Infinity
      let res = 1
      for (let i = 2; i <= num; i++) res *= i
      return res
    }
  }

  try {
    const context = vm.createContext(sandboxScope)

    const wrappedCode = `
      "use strict";
      (() => {
        ${code}
      })()
    `

    const script = new vm.Script(wrappedCode)
    const result = script.runInContext(context, {
      timeout: timeoutMs,
      displayErrors: true
    })

    const executionTimeMs = Date.now() - startTime

    let cleanResult = result
    try {
      if (result !== undefined) {
        cleanResult = JSON.parse(JSON.stringify(result))
      }
    } catch {
      cleanResult = String(result)
    }

    return {
      success: true,
      result: cleanResult,
      logs,
      executionTimeMs
    }
  } catch (err: any) {
    const executionTimeMs = Date.now() - startTime
    return {
      success: false,
      logs,
      error: err?.message || String(err),
      executionTimeMs
    }
  }
}
