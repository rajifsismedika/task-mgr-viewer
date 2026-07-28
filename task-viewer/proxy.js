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

const app = express()

// --- serve built Vue app ---
app.use(express.static(join(__dirname, 'dist')))

// --- local API routes ---
app.get('/api/user-names', (_req, res) => {
  const rows = db.query('SELECT uid, name FROM user_names').all()
  res.json(Object.fromEntries(rows.map(r => [r.uid, r.name])))
})

app.put('/api/user-names/:uid', express.json(), (req, res) => {
  const { uid } = req.params
  const { name } = req.body || {}
  if (!name || !name.trim()) {
    db.run('DELETE FROM user_names WHERE uid = ?', [uid])
  } else {
    db.run(
      'INSERT INTO user_names (uid, name) VALUES (?, ?) ON CONFLICT(uid) DO UPDATE SET name = excluded.name',
      [uid, name.trim()],
    )
  }
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
