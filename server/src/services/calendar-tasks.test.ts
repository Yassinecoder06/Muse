import assert from 'node:assert/strict'
import test from 'node:test'
import * as chrono from 'chrono-node'

test('chrono parses natural language relative dates and times accurately', () => {
  const refDate = new Date('2026-10-13T12:00:00Z')
  
  // "going to the gym at 20h tomorrow" / "at 8pm tomorrow"
  const parsed1 = chrono.parse('going to the gym at 8pm tomorrow', refDate)
  assert.ok(parsed1.length > 0)
  const date1 = parsed1[0].start.date()
  assert.equal(date1.getHours(), 20) // 8pm

  // "team standup on Friday at 10am"
  const parsed2 = chrono.parse('team standup on Friday at 10am', refDate)
  assert.ok(parsed2.length > 0)
  const date2 = parsed2[0].start.date()
  assert.equal(date2.getHours(), 10)

  // Cleaning the title by stripping the matched time text
  const matchText = parsed1[0].text
  const cleanedTitle = 'going to the gym at 8pm tomorrow'.replace(matchText, '').trim()
  assert.equal(cleanedTitle, 'going to the gym')
})

test('heuristic schedule and task detection extracts dates and action items from note text', () => {
  const noteText = `
Weekly Sprint Planning:
- Discuss architecture with Sarah tomorrow at 3pm
- Review pull requests on Thursday
- Buy groceries
- Finish documentation by Friday at 5pm
  `
  const lines = noteText.split('\n').map(l => l.trim()).filter(Boolean)
  const refDate = new Date('2026-10-13T12:00:00Z')
  
  const events: Array<{ title: string; date: Date }> = []
  const tasks: Array<{ text: string; date?: Date }> = []

  for (const line of lines) {
    const parsed = chrono.parse(line, refDate)
    if (parsed.length > 0 && parsed[0].start.isCertain('hour')) {
      events.push({
        title: line.replace(/^[-*•]\s*/, '').replace(parsed[0].text, '').trim(),
        date: parsed[0].start.date()
      })
    } else if (line.startsWith('-') || line.startsWith('*')) {
      tasks.push({
        text: line.replace(/^[-*•]\s*/, '').trim(),
        date: parsed.length > 0 ? parsed[0].start.date() : undefined
      })
    }
  }

  // Check extracted event
  assert.equal(events.length >= 1, true)
  assert.ok(events.some(e => e.title.includes('Discuss architecture with Sarah')))
  
  // Check extracted tasks
  assert.equal(tasks.length >= 1, true)
  assert.ok(tasks.some(t => t.text.includes('Buy groceries')))
})
