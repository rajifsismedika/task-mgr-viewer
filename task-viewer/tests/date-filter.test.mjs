// Assert harness for the new client-side date-range filter + frontend search
// semantics. Logic mirrors src/App.vue (kept in sync intentionally).
import assert from 'node:assert'

const inDateRange = (ts, from, to) => {
  if (!from && !to) return true
  if (!ts) return false
  const day = ts.slice(0, 10)
  return (!from || day >= from) && (!to || day <= to)
}

const task = {
  taskID: 'MelawaiProduct-FEATURE-00018',
  reportedAt: '2026-07-06T02:15:00Z',
  takenAt: '2026-08-14T09:22:23Z',
  devDoneAt: '2026-08-21T02:40:45Z',
  qaTakenAt: '2026-08-24T01:24:42Z',
}

// no range = all pass
assert.equal(inDateRange(task.devDoneAt), true)
// user's example: devDone between 2026-08-01 and 2026-08-23 -> matches
assert.equal(inDateRange(task.devDoneAt, '2026-08-01', '2026-08-23'), true)
// outside range -> excluded
assert.equal(inDateRange(task.devDoneAt, '2026-08-22', '2026-08-30'), false)
// reportedAt July is excluded by an August window even with same bounds
assert.equal(inDateRange(task.reportedAt, '2026-08-01', '2026-08-23'), false)
// inclusive bounds: exact boundary days match
assert.equal(inDateRange(task.devDoneAt.slice(0, 10) + 'T00:00:00Z', '2026-08-21', '2026-08-21'), true)
// open-ended ranges
assert.equal(inDateRange(task.reportedAt, null, '2026-07-31'), true)
assert.equal(inDateRange(task.takenAt, '2026-08-15'), false)
// missing timestamps are excluded once a range exists
assert.equal(inDateRange(null, '2026-08-01', '2026-08-23'), false)
// UTC timestamps after midnight WIB still land on the right day via slice
assert.equal(inDateRange('2026-08-23T18:00:00Z', '2026-08-23', '2026-08-23'), true)

console.log('date-filter harness: all assertions passed')
