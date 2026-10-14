import assert from 'node:assert/strict'
import test from 'node:test'
import { average, chart, percentChange, total } from './analytics.js'

test('deterministic KPI tools calculate totals, averages, and change', () => {
  const values = [{ label: 'Jan', value: 10 }, { label: 'Feb', value: 15 }]
  assert.equal(total(values), 25)
  assert.equal(average(values), 12.5)
  assert.equal(percentChange(10, 15), 50)
  assert.equal(percentChange(0, 15), null)
})

test('chart tool emits a data gap rather than a misleading visual', () => {
  assert.deepEqual(chart('bar', 'Revenue', [{ label: 'Only value', value: 1 }]), { kind: 'data-gap', message: 'Not enough reliable numeric data to render this visual.' })
  assert.equal(chart('line', 'Revenue', [{ label: 'Jan', value: 10 }, { label: 'Feb', value: 15 }]).kind, 'line')
})
