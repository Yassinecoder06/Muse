export function evaluateMath(rawExpr: string): number {
  let expr = rawExpr.trim()
  if (!expr) throw new Error('Mathematical expression cannot be empty.')

  // Support "X% of Y" -> "(X / 100 * Y)"
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*%\s*(?:of)?\s*([0-9a-zA-Z_().]+)/gi, '($1 / 100 * $2)')
  // Support standalone percentages "X%" -> "(X / 100)"
  expr = expr.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1 / 100)')
  // Support "^" as exponentiation "**"
  expr = expr.replace(/\^/g, '**')

  // Validate allowed characters for non-identifiers (digits, spaces, math symbols, parentheses)
  const nonIdent = expr.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, '')
  if (!/^[\d\s+\-*/%*().,]+$/.test(nonIdent)) {
    throw new Error('Expression contains disallowed characters.')
  }

  const allowedMath = new Set([
    'sqrt', 'cbrt', 'abs', 'round', 'floor', 'ceil', 'trunc',
    'pow', 'min', 'max', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    'log', 'log10', 'log2', 'exp', 'pi', 'PI', 'e', 'E'
  ])

  // Replace recognized math identifiers with Math.<ident>
  const sanitized = expr.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) => {
    if (allowedMath.has(match)) {
      const upper = match.toUpperCase()
      return upper === 'PI' || upper === 'E' ? `Math.${upper}` : `Math.${match}`
    }
    throw new Error(`Unknown mathematical token: "${match}". Only standard mathematical functions and constants are supported.`)
  })

  // Evaluate safely
  const fn = new Function(`"use strict"; return (${sanitized});`)
  const result = fn()
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error(`Expression evaluated to a non-finite number: ${result}`)
  }
  return Number(result.toFixed(8).replace(/\.?0+$/, ''))
}
