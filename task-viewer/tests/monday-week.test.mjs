import assert from 'node:assert'

const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mondayOf = value => {
  const d = new Date(`${value}T12:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localDate(d)
}
const shiftWeek = (week, days) => {
  const d = new Date(`${week}T12:00:00`)
  d.setDate(d.getDate() + days)
  return localDate(d)
}

assert.equal(mondayOf('2026-08-24'), '2026-08-24')
assert.equal(mondayOf('2026-08-30'), '2026-08-24')
assert.equal(mondayOf('2026-08-26'), '2026-08-24')
assert.equal(shiftWeek('2026-08-24', -7), '2026-08-17')
assert.equal(shiftWeek('2026-08-24', 7), '2026-08-31')
console.log('monday-week harness: all assertions passed')
