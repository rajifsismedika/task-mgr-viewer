import { Database } from 'bun:sqlite'
import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const db = new Database(join(dataDir, 'task-mgr.db'))
db.run(`CREATE TABLE IF NOT EXISTS user_names (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL
)`)
db.run(`CREATE TABLE IF NOT EXISTS task_tags (
  taskID TEXT PRIMARY KEY,
  isBlocker INTEGER NOT NULL DEFAULT 0,
  inDate TEXT NOT NULL DEFAULT '',
  devDoneDate TEXT NOT NULL DEFAULT '',
  sprint TEXT NOT NULL DEFAULT ''
)`)
db.run(`CREATE TABLE IF NOT EXISTS week_plan_entries (
  taskID TEXT NOT NULL,
  week TEXT NOT NULL,
  execDate TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT '',
  isAdhoc INTEGER NOT NULL DEFAULT 0,
  carryOver INTEGER NOT NULL DEFAULT 0,
  firstPlanned TEXT NOT NULL DEFAULT '',
  blocker TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PLANNED',
  doneDate TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (week, taskID)
)`)

const app = express()

// --- serve built Vue app ---
app.use(express.static(join(__dirname, 'dist')))

// --- local API routes ---
app.get('/api/task-tags', (_req, res) => {
  const rows = db.query('SELECT * FROM task_tags').all()
  const out = {}
  for (const r of rows) {
    out[r.taskID] = {
      isBlocker: !!r.isBlocker,
      inDate: r.inDate || '',
      devDoneDate: r.devDoneDate || '',
      sprint: r.sprint || '',
    }
  }
  res.json(out)
})

app.put('/api/task-tags', express.json(), (req, res) => {
  const { taskID } = req.body || {}
  const b = req.body || {}
  if (!taskID) return res.status(400).json({ error: 'taskID required' })

  const isBlocker = b.isBlocker ? 1 : 0
  const inDate = String(b.inDate || '')
  const devDoneDate = String(b.devDoneDate || '')
  const sprint = String(b.sprint || '')

  // If everything empty → delete row
  if (!isBlocker && !inDate && !devDoneDate && !sprint) {
    db.run('DELETE FROM task_tags WHERE taskID = ?', [taskID])
  } else {
    db.run(
      `INSERT INTO task_tags (taskID, isBlocker, inDate, devDoneDate, sprint)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(taskID) DO UPDATE SET
         isBlocker = excluded.isBlocker,
         inDate = excluded.inDate,
         devDoneDate = excluded.devDoneDate,
         sprint = excluded.sprint`,
      [taskID, isBlocker, inDate, devDoneDate, sprint],
    )
  }
  res.json({ ok: true })
})

app.get('/api/user-names', (_req, res) => {
  const rows = db.query('SELECT uid, name FROM user_names').all()
  res.json(Object.fromEntries(rows.map(r => [r.uid, r.name])))
})

app.put('/api/user-names/:uid', express.json(), (req, res) => {
  const { uid } = req.params
  const { name } = req.body || {}
  if (!name || !name.trim()) db.run('DELETE FROM user_names WHERE uid = ?', [uid])
  else db.run(
    'INSERT INTO user_names (uid, name) VALUES (?, ?) ON CONFLICT(uid) DO UPDATE SET name = excluded.name',
    [uid, name.trim()],
  )
  res.json({ ok: true })
})

// --- weekly plan: private local metadata, access is additionally UI-gated to rajif ---
app.get('/api/week-plan', (req, res) => {
  const week = String(req.query.week || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return res.status(400).json({ error: 'week (YYYY-MM-DD) required' })
  const rows = db.query('SELECT * FROM week_plan_entries WHERE week = ? ORDER BY execDate, taskID').all(week)
  res.json(Object.fromEntries(rows.map(r => [r.taskID, {
    ...r, isAdhoc: !!r.isAdhoc, carryOver: !!r.carryOver,
  }])))
})

app.put('/api/week-plan', express.json(), (req, res) => {
  const b = req.body || {}
  if (!b.taskID || !/^\d{4}-\d{2}-\d{2}$/.test(b.week || '')) {
    return res.status(400).json({ error: 'taskID and week (YYYY-MM-DD) required' })
  }
  const text = key => String(b[key] || '').trim()
  db.run(`INSERT INTO week_plan_entries (taskID, week, execDate, priority, isAdhoc, carryOver, firstPlanned, blocker, status, doneDate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(week, taskID) DO UPDATE SET execDate=excluded.execDate,
    priority=excluded.priority, isAdhoc=excluded.isAdhoc, carryOver=excluded.carryOver,
    firstPlanned=excluded.firstPlanned, blocker=excluded.blocker, status=excluded.status, doneDate=excluded.doneDate`,
    [text('taskID'), text('week'), text('execDate'), text('priority'), b.isAdhoc ? 1 : 0,
      b.carryOver ? 1 : 0, text('firstPlanned'), text('blocker'), text('status') || 'PLANNED', text('doneDate')])
  res.json({ ok: true })
})

app.delete('/api/week-plan/:taskID', (req, res) => {
  const week = String(req.query.week || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return res.status(400).json({ error: 'week (YYYY-MM-DD) required' })
  db.run('DELETE FROM week_plan_entries WHERE taskID = ? AND week = ?', [req.params.taskID, week])
  res.json({ ok: true })
})

// --- worklog endpoint (session-based auth to taskmanager) ---
const TM_BASE = 'https://taskmanager.minipc.sismedika.biz.id'

app.post('/api/worklog', express.urlencoded({ extended: false }), async (req, res) => {
  const { taskId, description, date, hours, username, password } = req.body || {}
  if (!taskId || !date || !hours || !username || !password) {
    return res.status(400).json({ error: 'taskId, date, hours, username, password required' })
  }

  try {
    // Step 1: login as the user to get session cookies + CSRF token
    const loginRes = await fetch(`${TM_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }),
      redirect: 'manual',
    })

    const setCookies = loginRes.headers.getSetCookie?.() || []
    const cookieHeader = setCookies.map(c => c.split(';')[0]).join('; ')

    // extract CSRF token
    const csrfMatch = cookieHeader.match(/taskmgn_csrf=([^;]+)/)
    const csrfToken = csrfMatch ? csrfMatch[1] : ''

    if (!cookieHeader.includes('taskmgn_session')) {
      return res.status(401).json({ error: 'Login failed — check credentials' })
    }

    // Step 2: submit worklog as the user
    const worklogRes = await fetch(`${TM_BASE}/tasks/${encodeURIComponent(taskId)}/worklogs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader,
        'X-CSRF-Token': csrfToken,
      },
      body: new URLSearchParams({ description: description || '', date, hours }),
    })

    if (!worklogRes.ok) {
      const text = await worklogRes.text()
      return res.status(worklogRes.status).json({ error: text || worklogRes.statusText })
    }

    const html = await worklogRes.text()
    res.json({ ok: true, html })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- everything else → task-manager proxy ---
app.use(
  createProxyMiddleware({
    target: TM_BASE,
    changeOrigin: true,
  }),
)

const PORT = parseInt(process.env.PORT || '3001')
app.listen(PORT, () => {
  console.log(`Task Viewer running on http://0.0.0.0:${PORT}`)
})
