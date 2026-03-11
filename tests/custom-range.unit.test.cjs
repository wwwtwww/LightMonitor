const test = require('node:test')
const assert = require('node:assert/strict')

function parseDate(s) {
  const str = String(s || '').trim()
  if (!str) return null
  const d = new Date(str.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return null
  return d
}

function disableEndDateFactory(startValue, nowMs) {
  return function disableEndDate(d) {
    const t = d.getTime()
    if (t > nowMs) return true
    const s = parseDate(startValue)
    if (!s) return false
    const endDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const startDay = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime()
    return endDay < startDay
  }
}

test('parseDate should parse custom picker format', () => {
  const d = parseDate('2026-03-11 14:20:00')
  assert.ok(d instanceof Date)
  assert.equal(Number.isNaN(d.getTime()), false)
})

test('same day end-date stays enabled when start has time part', () => {
  const start = '2026-03-11 14:20:00'
  const nowMs = new Date('2026-03-12T00:00:00').getTime()
  const disableEndDate = disableEndDateFactory(start, nowMs)
  const sameDayCell = new Date('2026-03-11T00:00:00')
  assert.equal(disableEndDate(sameDayCell), false)
})

test('previous day end-date is disabled', () => {
  const start = '2026-03-11 14:20:00'
  const nowMs = new Date('2026-03-12T00:00:00').getTime()
  const disableEndDate = disableEndDateFactory(start, nowMs)
  const previousDayCell = new Date('2026-03-10T00:00:00')
  assert.equal(disableEndDate(previousDayCell), true)
})
