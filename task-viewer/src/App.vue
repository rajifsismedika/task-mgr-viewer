<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import UsersPage from './UsersPage.vue'
import StatsPage from './StatsPage.vue'

// --- version / update check ---
const BUILD_ID = Date.now() // set at build time, embedded in JS bundle
const newBuildAvailable = ref(false)

onMounted(async () => {
  if (!taskToken.value) {
    await loginAndFetch()
  }
  await loadUserNames()
  await loadCustomTags()
  if (taskToken.value) {
    await fetchProducts()
    // no auto-select: tasks load only for products chosen in the Product filter
    if (selectedProducts.value.length) fetchTasks()
  }
  // poll for new build
  checkNewBuild()
  setInterval(checkNewBuild, 15_000)
})

async function checkNewBuild() {
  try {
    const res = await fetch('/version.json?t=' + Date.now())
    if (!res.ok) return
    const v = await res.json()
    const seenId = localStorage.getItem('task_build_id')
    if (!seenId) {
      localStorage.setItem('task_build_id', String(v.buildId))
      return
    }
    if (v.buildId !== Number(seenId)) newBuildAvailable.value = true
  } catch { /* ignore */ }
}

function reloadApp() {
  localStorage.setItem('task_build_id', String(BUILD_ID))
  location.reload()
}

const logout = () => {
  taskToken.value = ''
  localStorage.removeItem('task_token')
}

const tasks = ref([])
const products = ref([])
const error = ref(null)
const loading = ref(false)
const activePage = ref('tasks')

const loginData = ref({
  username: 'rajif',
  password: 'vA9Wf6qw8Srq'
})

const taskToken = ref(localStorage.getItem('task_token') || '')
const fetchStatus = ref('')
const hideDone = ref(false)

const fetchProducts = async () => {
  if (!taskToken.value) return
  const res = await fetch('/api/v1/master/products', {
    headers: { 'Authorization': `Bearer ${taskToken.value}` }
  })
  if (res.ok) {
    const data = await res.json()
    products.value = Array.isArray(data) ? data : (data.items || data.data || [])
  }
}

const loginAndFetch = async () => {
  loading.value = true
  error.value = null
  fetchStatus.value = 'Logging in...'

  try {
    const loginRes = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginData.value)
    })

    if (!loginRes.ok) throw new Error('Login failed')
    const data = await loginRes.json()
    taskToken.value = data.accessToken
    localStorage.setItem('task_token', taskToken.value)
    await loadUserNames()
    await loadCustomTags()

    await fetchProducts()
    if (selectedProducts.value.length) await fetchTasks()
  } catch (err) {
    error.value = err.message
    loading.value = false
  }
}

const fetchTasks = async () => {
  if (!taskToken.value) return loginAndFetch()
  // Tasks are only fetched for products explicitly selected in the Product filter.
  if (!selectedProducts.value.length) {
    tasks.value = []
    fetchStatus.value = 'Select at least one product to load tasks'
    return
  }

  loading.value = true
  fetchStatus.value = 'Fetching tasks...'
  error.value = null

  try {
    const pageSize = 100 // API hard limit
    const seen = new Set()
    const allItems = []
    let failedProduct = null

    // Fetch each selected product independently (API only supports one product param)
    for (const product of selectedProducts.value) {
      let currentPage = 1
      while (true) {
        const url = `/api/v1/tasks?pageSize=${pageSize}&page=${currentPage}&product=${encodeURIComponent(product)}`

        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${taskToken.value}` }
        })

        if (res.status === 401) {
          taskToken.value = ''
          localStorage.removeItem('task_token')
          return loginAndFetch()
        }

        if (!res.ok) {
          failedProduct = product
          break
        }

        const data = await res.json()
        const fetchedItems = data.items || []

        for (const item of fetchedItems) {
          const id = item.taskID || item.id
          if (id && !seen.has(id)) {
            seen.add(id)
            allItems.push(item)
          }
        }

        if (fetchedItems.length < pageSize || allItems.length >= (data.total || 0)) {
          break
        }

        currentPage++
        fetchStatus.value = `Fetching ${product} (Page ${currentPage})...`
      }
      if (failedProduct) break
    }

    if (failedProduct) {
      throw new Error(`Failed to fetch tasks for product: ${failedProduct}`)
    }

    tasks.value = allItems
    fetchStatus.value = `Loaded ${tasks.value.length} tasks`
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// Resolve any user ID to a mapped name (Users page maintains the mapping).
const userName = (uid) => (uid ? (userNames.value[uid] || uid.slice(0, 8)) : '')
// ponytail: unmapped users fall back to an 8-char ID prefix; widen once names exist in Users page.
const getUserName = (task) => userName(task.assigneeUserID || task.preAssignedUserID || task.takenByUserID)

// ISO timestamp -> YYYY-MM-DD for table display.
const fmtDate = (ts) => (ts ? String(ts).slice(0, 10) : '')

const userColors = {}
const getUserColor = (task) => {
  const uid = task.assigneeUserID || task.preAssignedUserID || task.takenByUserID
  if (!uid) return '#e5e7eb'
  return getAssignColor(uid)
}
const getAssignColor = (uid) => {
  if (!userColors[uid]) {
    const palette = [
      '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
      '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
      '#14b8a6', '#e11d48', '#0ea5e9', '#a855f7', '#d946ef'
    ]
    let hash = 0
    for (let i = 0; i < uid.length; i++) hash = ((hash << 5) - hash) + uid.charCodeAt(i) | 0
    userColors[uid] = palette[Math.abs(hash) % palette.length]
  }
  return userColors[uid]
}

const statusOrder = ["REPORTED", "IN_DEV", "DEV_DONE", "QA_IN_PROGRESS", "QA_DONE", "QC_IN_PROGRESS", "QC_DONE", "HOLD", "DELETED"]

// --- Filter state (all persisted) ---
// EXCEL-STYLE semantics (v6):
//  - Each filter: empty selection = All; multiple values OR together.
//  - Filters AND together (a task must pass EVERY active filter).
//  - A task matches on its OWN values only (no inheritance, no roll-up).
//  - Status hiding = row hidden: hidden statuses never render.
//  - Tree = display only: a node renders if it matches the filters OR has a
//    visible child (container). Nothing is "deleted" conceptually — a parent
//    row stays so its matching children remain reachable, exactly like an
//    Excel row that contains a matching cell stays visible.
const savedStatuses = localStorage.getItem('task_hidden_statuses')
const hiddenStatuses = ref(savedStatuses ? JSON.parse(savedStatuses) : ['QC_DONE', 'QA_DONE', 'DELETED'])
const selectedProducts = ref(JSON.parse(localStorage.getItem('task_selected_products') || '[]'))
const assigneesFilter = ref(JSON.parse(localStorage.getItem('task_assignee_filter') || '[]'))
const searchQuery = ref(localStorage.getItem('task_search_query') || '')
// Frontend-only search: no `search` param is ever sent to the API.
const doSearch = () => { searchQuery.value = searchQuery.value.trim() }
const blockerFilter = ref(localStorage.getItem('task_blocker_filter') || 'all')
const sprintsFilter = ref(JSON.parse(localStorage.getItem('task_sprint_filter') || '[]'))

// Date-range filter: per-field from/to (YYYY-MM-DD, inclusive, both optional).
const DATE_FIELDS = [
  { key: 'reportedAt', label: 'Reported' },
  { key: 'takenAt', label: 'Taken' },
  { key: 'devDoneAt', label: 'Dev Done' },
  { key: 'qaTakenAt', label: 'QA Taken' },
]
const dateFilter = ref(JSON.parse(localStorage.getItem('task_date_filter') || '{}'))
const setDateFilter = (field, bound, value) => {
  if (!dateFilter.value[field]) dateFilter.value[field] = {}
  if (value) dateFilter.value[field][bound] = value
  else delete dateFilter.value[field][bound]
  if (!Object.keys(dateFilter.value[field]).length) delete dateFilter.value[field]
  localStorage.setItem('task_date_filter', JSON.stringify(dateFilter.value))
}
const clearDateFilter = () => {
  dateFilter.value = {}
  localStorage.setItem('task_date_filter', '{}')
}
const activeDateCount = () => Object.keys(dateFilter.value).length

// Parent filter: single-select. 'all' = no parent filter; otherwise show only
// the chosen parent and its subtree (direct children + descendants). Persisted.
const parentFilter = ref(localStorage.getItem('task_parent_filter') || 'all')
const setParentFilter = (value) => {
  parentFilter.value = value
  localStorage.setItem('task_parent_filter', value)
}

// Sort mode: 'reported' = reportedAt descending (newest first, default);
// 'status' = status workflow order. Persisted.
const savedSort = localStorage.getItem('task_sort_mode')
const sortMode = ref(savedSort === 'status' ? 'status' : 'reported')
const setSortMode = (mode) => {
  sortMode.value = mode
  localStorage.setItem('task_sort_mode', mode)
}

const sortCompare = (a, b) => {
  if (sortMode.value === 'status') return getStatusVal(a.status) - getStatusVal(b.status)
  // reportedAt descending: newest first; missing dates sort last (stable).
  const ta = a.reportedAt || a.createdAt || ''
  const tb = b.reportedAt || b.createdAt || ''
  if (!ta && !tb) return 0
  if (!ta) return 1
  if (!tb) return -1
  return new Date(tb) - new Date(ta)
}

const searchTasks = () => {
  doSearch()
}

const handleSearchKeydown = (e) => {
  if (e.key === 'Enter') searchTasks()
}

const updateBlockerFilter = () => {
  localStorage.setItem('task_blocker_filter', blockerFilter.value)
}

// --- user names loaded from server-side DB ---
const userNames = ref({})
const loadUserNames = async () => {
  try {
    const res = await fetch('/api/user-names')
    if (res.ok) userNames.value = await res.json()
  } catch { /* proxy not ready */ }
}
const updateUserName = async (uid, name) => {
  await fetch(`/api/user-names/${encodeURIComponent(uid)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  // optimistic update
  if (!name.trim()) delete userNames.value[uid]
  else userNames.value[uid] = name.trim()
}

const customTags = ref({})

// Load custom tags (sprint, blocker, dates) from DB
const loadCustomTags = async () => {
  try {
    const res = await fetch('/api/task-tags')
    if (res.ok) customTags.value = await res.json()
  } catch { /* proxy not ready */ }
}

const DB_TAG_FIELDS = ['isBlocker', 'inDate', 'devDoneDate', 'sprint']
let taskTagSaveQueue = {}
let taskTagSaveTimer = null

const saveCustomTags = (taskID) => {
  taskTagSaveQueue[taskID] = { ...customTags.value[taskID] }
  if (taskTagSaveTimer) clearTimeout(taskTagSaveTimer)
  taskTagSaveTimer = setTimeout(async () => {
    const pending = taskTagSaveQueue
    taskTagSaveQueue = {}
    for (const [id, tags] of Object.entries(pending)) {
      try {
        await fetch('/api/task-tags', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskID: id, ...tags }),
        })
      } catch { /* ignore */ }
    }
  }, 400)
}

const copyTask = (task) => {
  const id = task.taskID || task.id
  navigator.clipboard.writeText(`${id} | ${task.title}`)
}

const updateCustomTag = (task, field, value) => {
  const id = task.taskID || task.id
  if (!customTags.value[id]) {
    customTags.value[id] = { isBlocker: false, inDate: '', devDoneDate: '', sprint: '' }
  }
  customTags.value[id][field] = value

  // Clean up if all empty
  if (!customTags.value[id].isBlocker && !customTags.value[id].inDate &&
      !customTags.value[id].devDoneDate && !customTags.value[id].sprint) {
    delete customTags.value[id]
  }

  saveCustomTags(id)
}

const flatTaskTree = computed(() => {
  const result = []
  const traverse = (node, depth) => {
    result.push({ ...node, _depth: depth })
    if (node.children && node.children.length) {
      node.children.forEach(c => traverse(c, depth + 1))
    }
  }
  taskTree.value.forEach(t => traverse(t, 0))
  return result
})

// summary of active filters, shown on the Stats tab
const filterSummary = computed(() => {
  const parts = []
  parts.push(selectedProducts.value.length ? `Product: ${selectedProducts.value.join(', ')}` : 'Product: All')
  parts.push(assigneesFilter.value.length
    ? `Assignee: ${assigneesFilter.value.map(u => u === '__unassigned__' ? 'Not Assigned' : (userNames.value[u] || u)).join(', ')}`
    : 'Assignee: All')
  parts.push(sprintsFilter.value.length
    ? `Sprint: ${sprintsFilter.value.map(s => s === '__nosprint__' ? 'Not in Sprint' : s).join(', ')}`
    : 'Sprint: All')
  parts.push(`Blocker: ${blockerFilter.value === 'all' ? 'All' : blockerFilter.value === 'blocked' ? 'Blocked' : 'Not Blocked'}`)
  for (const { key, label } of DATE_FIELDS) {
    const r = dateFilter.value[key]
    if (r && (r.from || r.to)) parts.push(`${label}: ${r.from || '…'} → ${r.to || '…'}`)
  }
  if (hiddenStatuses.value.length) parts.push(`Hidden statuses: ${hiddenStatuses.value.join(', ')}`)
  if (searchQuery.value) parts.push(`Search: "${searchQuery.value}"`)
  return parts.join('  ·  ')
})

const exportToExcel = () => {
  const rows = flatTaskTree.value.map(task => ({
    '#': task._depth,
    STATUS: getEffectiveStatus(task),
    ID: task.taskID || task.id,
    TITLE: (task._depth ? '↳ '.repeat(task._depth) : '') + (task.title || ''),
    PRODUCT: task.productCode || task.product || '',
    ASSIGNEE: getUserName(task),
    'REPORTED BY': userName(task.reportedByUserID),
    BLOCKER: customTags.value[task.taskID || task.id]?.isBlocker ? 'Yes' : '',
    SPRINT: customTags.value[task.taskID || task.id]?.sprint || '',
    TAKEN: fmtDate(task.takenAt),
    'DEV DONE': fmtDate(task.devDoneAt),
    'QA BY': userName(task.qaTakenByUserID),
    'QA TAKEN': fmtDate(task.qaTakenAt)
  }))
  // Build TSV (tab-separated) — pastes cleanly into Excel
  const headers = Object.keys(rows[0] || {})
  const esc = v => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')
  const tsv = [headers.join('\t'), ...rows.map(r => headers.map(h => esc(r[h])).join('\t'))].join('\n')
  const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const product = selectedProducts.value.join('_') || 'all'
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`
  a.href = url
  a.download = `tasks_${product}_${stamp}.tsv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const toggleStatus = (status) => {
  const idx = hiddenStatuses.value.indexOf(status)
  if (idx === -1) hiddenStatuses.value.push(status)
  else hiddenStatuses.value.splice(idx, 1)

  localStorage.setItem('task_hidden_statuses', JSON.stringify(hiddenStatuses.value))
}

const setAllStatuses = (hide) => {
  hiddenStatuses.value = hide ? [...statusOrder] : []
  localStorage.setItem('task_hidden_statuses', JSON.stringify(hiddenStatuses.value))
  // Show All is a FULL RESET: also clear every other client-side filter so the
  // list actually shows everything again. Hide All only touches statuses.
  if (!hide) {
    sprintsFilter.value = []
    localStorage.setItem('task_sprint_filter', '[]')
    assigneesFilter.value = []
    localStorage.setItem('task_assignee_filter', '[]')
    blockerFilter.value = 'all'
    localStorage.setItem('task_blocker_filter', 'all')
    setParentFilter('all')
    searchQuery.value = ''
    localStorage.setItem('task_search_query', '')
    clearDateFilter()
  }
}

const getStatusVal = (status) => {
  const idx = statusOrder.indexOf(status)
  if (status === 'HOLD') return 3.5
  if (status === 'DELETED') return 999
  return idx === -1 ? 999 : idx
}

const availableProducts = computed(() => {
  return products.value.map(p => p.code || p.productCode || p.name).sort()
})

const availableAssignees = computed(() => {
  const set = new Set()
  tasks.value.forEach(t => {
    const uid = t.assigneeUserID || t.preAssignedUserID || t.takenByUserID
    if (uid) set.add(uid)
  })
  return Array.from(set).sort().map(uid => ({ uid, name: userNames.value[uid] || uid }))
})

// Parent filter options: task IDs that are parents of at least one loaded task.
const parentOptions = computed(() => {
  const set = new Set()
  tasks.value.forEach(t => {
    if (t.parentTaskID) set.add(t.parentTaskID)
  })
  return Array.from(set).sort()
})

const availableSprints = computed(() => {
  // own-tag sprint values only (no parent inheritance) — matches the filter
  const set = new Set()
  tasks.value.forEach(t => {
    const s = customTags.value[t.taskID || t.id]?.sprint
    if (s) set.add(s)
  })
  return Array.from(set).sort()
})

// --- Excel-style multi-filter chip state ---
const activeFilterChip = ref('')
const toggleFilterChip = (name) => {
  activeFilterChip.value = activeFilterChip.value === name ? '' : name
}

// --- per-filter dropdown search (Excel/Sheets-style: filter the option list) ---
const filterSearch = ref({ product: '', assignee: '', sprint: '' })
const setFilterSearch = (name, value) => {
  filterSearch.value[name] = value
  if (value) activeFilterChip.value = name // keep dropdown open while typing
}
const filteredProducts = computed(() =>
  availableProducts.value.filter(p => p.toLowerCase().includes(filterSearch.value.product.toLowerCase()))
)
const filteredAssignees = computed(() => {
  const q = filterSearch.value.assignee.toLowerCase()
  return availableAssignees.value.filter(a => a.name.toLowerCase().includes(q) || a.uid.toLowerCase().includes(q))
})
const filteredSprints = computed(() =>
  availableSprints.value.filter(s => s.toLowerCase().includes(filterSearch.value.sprint.toLowerCase()))
)

// --- multi-select helpers (generic) ---
const toggleInList = (listRef, value) => {
  const arr = listRef.value
  const idx = arr.indexOf(value)
  if (idx === -1) arr.push(value)
  else arr.splice(idx, 1)
  localStorage.setItem(listRef._key, JSON.stringify(arr))
}
// bind localStorage keys to list refs
const FILTER_KEYS = {
  selectedProducts: 'task_selected_products',
  assigneesFilter: 'task_assignee_filter',
  sprintsFilter: 'task_sprint_filter',
}
for (const [k, key] of Object.entries(FILTER_KEYS)) {
  const r = { selectedProducts, assigneesFilter, sprintsFilter }[k]
  r._key = key
}

const toggleProductFilter = (prod) => {
  toggleInList(selectedProducts, prod)
  // Load tasks only for the products selected in the filter
  if (!selectedProducts.value.length) {
    tasks.value = []
    fetchStatus.value = 'Select at least one product to load tasks'
  } else {
    fetchTasks()
  }
}
const toggleAssigneeFilter = (uid) => toggleInList(assigneesFilter, uid)
const toggleSprintFilter = (sprint) => toggleInList(sprintsFilter, sprint)

const clearFilter = (name) => {
  const listRef = { selectedProducts, assigneesFilter, sprintsFilter }[name]
  listRef.value = []
  localStorage.setItem(listRef._key, '[]')
  // also reset the popup search box so the option list is not left filtered
  if (name === 'selectedProducts') filterSearch.value.product = ''
  if (name === 'assigneesFilter') filterSearch.value.assignee = ''
  if (name === 'sprintsFilter') filterSearch.value.sprint = ''
  if (listRef === selectedProducts) {
    tasks.value = []
    fetchStatus.value = 'Select at least one product to load tasks'
  }
}

// --- task filtering (EXCEL-STYLE: own values only, tree = display) ---
const getTaskProduct = (task) => task.productCode || task.product || ''
const getTaskAssignee = (task) => task.assigneeUserID || task.preAssignedUserID || task.takenByUserID || ''
const getTaskSprint = (task) => customTags.value[task.taskID || task.id]?.sprint || ''

// matchesColumn: pure per-task predicate on the task's OWN values.
// Empty = All; values OR; filters AND.
const matchesColumn = (task) => {
  // Product
  if (selectedProducts.value.length && !selectedProducts.value.includes(getTaskProduct(task))) return false
  // Assignee (__unassigned__ = no assignee)
  if (assigneesFilter.value.length) {
    const a = getTaskAssignee(task)
    const wantUnassigned = assigneesFilter.value.includes('__unassigned__')
    if (!wantUnassigned && !a) return false
    if (a && !assigneesFilter.value.includes(a)) return false
    if (!a && !wantUnassigned) return false
  }
  // Sprint (__nosprint__ = no sprint)
  if (sprintsFilter.value.length) {
    const s = getTaskSprint(task)
    const wantNoSprint = sprintsFilter.value.includes('__nosprint__')
    if (!wantNoSprint && !s) return false
    if (s && !sprintsFilter.value.includes(s)) return false
    if (!s && !wantNoSprint) return false
  }
  // Blocker
  if (blockerFilter.value === 'blocked' && !customTags.value[task.taskID || task.id]?.isBlocker) return false
  if (blockerFilter.value === 'not_blocked' && customTags.value[task.taskID || task.id]?.isBlocker) return false
  // Status (hidden = row hidden, never rendered)
  if (hiddenStatuses.value.includes(getEffectiveStatus(task))) return false
  // Date ranges (per-field from/to, inclusive)
  for (const { key } of DATE_FIELDS) {
    const r = dateFilter.value[key]
    if (r && !inDateRange(task[key], r.from, r.to)) return false
  }
  // Frontend-only text search
  if (!matchesSearch(task)) return false
  // Parent filter: only the chosen parent and its subtree
  if (parentFilter.value !== 'all') {
    if ((task.taskID || task.id) === parentFilter.value) return true // the parent itself
    let cur = task
    while (cur) {
      if (!cur.parentTaskID) return false // reached a root that isn't the chosen parent
      if (cur.parentTaskID === parentFilter.value) return true // descendant of chosen parent
      cur = taskMap.value[cur.parentTaskID]
      if (!cur) return false
    }
    return false
  }
  return true
}

const taskMap = computed(() => {
  const map = {}
  if (tasks.value.length) {
    tasks.value.forEach(t => {
      map[t.taskID || t.id] = t
    })
  }
  return map
})

// Frontend-only text search over the fields shown in the table.
const matchesSearch = (task) => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return true
  const id = task.taskID || task.id || ''
  return [id, task.title, task.description,
    getUserName(task),
    userName(task.reportedByUserID), userName(task.qaTakenByUserID)]
    .some(v => String(v || '').toLowerCase().includes(q))
}

// Inclusive YYYY-MM-DD range check against a task timestamp (null-safe).
const inDateRange = (ts, from, to) => {
  if (!from && !to) return true
  if (!ts) return false
  const day = ts.slice(0, 10)
  return (!from || day >= from) && (!to || day <= to)
}

const dateRangeActive = (field) => {
  const r = dateFilter.value[field]
  return !!(r && (r.from || r.to))
}

const taskTree = computed(() => {
  if (!tasks.value.length) return []

  // Build a fresh copy of the tree (no mutation of raw tasks).
  const map = {}
  tasks.value.forEach(t => {
    const id = t.taskID || t.id
    map[id] = { ...t, children: [] }
  })
  const roots = []
  Object.values(map).forEach(t => {
    if (t.parentTaskID && map[t.parentTaskID]) map[t.parentTaskID].children.push(t)
    else roots.push(t)
  })

  // EXCEL-STYLE walk: a node renders if it matches the filter columns OR has
  // a visible child (container). A hidden-status node also stays as a
  // container (hidden status = row hidden, but its matching children still
  // show under it — Excel keeps the row context). Children keep their parent;
  // nothing is promoted or orphaned.
  const collectVisible = (node) => {
    node.children = node.children.filter(child => collectVisible(child))
    if (matchesColumn(node)) return true
    return node.children.length > 0
  }

  const visibleRoots = roots.filter(r => collectVisible(r))
  // Sort per level
  const sortTree = (nodes) => {
    nodes.sort(sortCompare)
    nodes.forEach(n => sortTree(n.children))
  }
  sortTree(visibleRoots)
  return visibleRoots
})

const getStatusColor = (status) => {
  const colors = {
    REPORTED: '#6b7280',     // gray
    IN_DEV: '#3b82f6',       // blue
    DEV_DONE: '#8b5cf6',     // purple
    QA_IN_PROGRESS: '#f59e0b', // amber
    QA_DONE: '#d97706',      // darker amber
    QC_IN_PROGRESS: '#06b6d4', // cyan
    QC_DONE: '#10b981',       // green
    HOLD: '#ea580c',          // orange
    DELETED: '#dc2626'        // red
  }
  return colors[status] || '#9ca3af'
}

const getEffectiveStatus = (task) => {
  if (task.isDeleted) return 'DELETED'
  if (task.isOnHold) return 'HOLD'
  return task.status
}

// old onMounted removed — moved up for version polling

// --- user auth for worklog submissions ---
const userLoginData = ref(JSON.parse(localStorage.getItem('user_credentials') || 'null') || { username: '', password: '' })
const userLoginError = ref('')

// auto-save credentials to localStorage on change
watch(userLoginData, (v) => {
  localStorage.setItem('user_credentials', JSON.stringify(v))
}, { deep: true })

// --- worklog inline form ---
const worklogTaskId = ref(null)
const worklogForm = ref({ description: '', date: todayStr(), hours: '' })
const worklogSubmitting = ref(false)
const worklogMsg = ref({ taskId: null, ok: false, text: '' })

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

const toggleWorklog = (task) => {
  const id = task.taskID || task.id
  if (worklogTaskId.value === id) {
    worklogTaskId.value = null
  } else {
    worklogTaskId.value = id
    worklogForm.value = { description: '', date: todayStr(), hours: '' }
    worklogMsg.value = { taskId: null, ok: false, text: '' }
  }
}

const submitWorklog = async (task) => {
  const id = task.taskID || task.id
  if (!worklogForm.value.description.trim() || !worklogForm.value.hours) return
  if (!userLoginData.value.username || !userLoginData.value.password) {
    worklogMsg.value = { taskId: id, ok: false, text: 'Enter credentials above' }
    return
  }
  worklogSubmitting.value = true
  worklogMsg.value = { taskId: null, ok: false, text: '' }
  try {
    const res = await fetch('/api/worklog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        taskId: id,
        description: worklogForm.value.description.trim(),
        date: worklogForm.value.date,
        hours: String(worklogForm.value.hours),
        username: userLoginData.value.username,
        password: userLoginData.value.password,
      }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt || res.statusText)
    }
    worklogMsg.value = { taskId: id, ok: true, text: '✓ Logged' }
    localStorage.setItem('user_credentials', JSON.stringify(userLoginData.value))
    worklogForm.value = { description: '', date: todayStr(), hours: '' }
    setTimeout(() => { worklogMsg.value.taskId = null }, 2500)
  } catch (err) {
    worklogMsg.value = { taskId: id, ok: false, text: err.message }
  } finally {
    worklogSubmitting.value = false
  }
}
</script>

<template>
  <div v-if="newBuildAvailable" class="update-banner" @click="reloadApp">
    🔄 New version available — click to reload
  </div>
  <div class="container">
    <header>
      <h1>Task Tree Viewer</h1>
      <div class="nav-tabs">
        <button class="nav-tab" :class="{ active: activePage === 'tasks' }" @click="activePage='tasks'">Tasks</button>
        <button class="nav-tab" :class="{ active: activePage === 'stats' }" @click="activePage='stats'">📊 Stats</button>
        <button class="nav-tab" :class="{ active: activePage === 'users' }" @click="activePage='users'">Users</button>
      </div>
      <div class="actions" v-if="activePage === 'tasks'">
        <!-- Excel/Sheets-style filter bar -->
        <div class="filters">
          <input type="text" v-model="searchQuery" @keydown="handleSearchKeydown" placeholder="🔍 Filter ID / title / user... (client-side)"
                 class="filter-search" />

          <!-- Column filter chips: Product / Assignee / Sprint / Blocker -->
          <div class="filter-chip-group">
            <div class="filter-chip-wrap">
              <button class="filter-chip" :class="{ active: activeFilterChip === 'product' }"
                      @click.stop="toggleFilterChip('product')">
                Product
                <span class="chip-count" v-if="selectedProducts.length">{{ selectedProducts.length }}</span>
                <span class="chip-caret">▾</span>
              </button>
              <div v-if="activeFilterChip === 'product'" class="filter-popup" @click.stop>
                <div class="popup-head">
                  <span>Product</span>
                  <button class="popup-clear" @click="clearFilter('selectedProducts')">Clear</button>
                </div>
                <div class="popup-search">
                  <input type="text" v-model="filterSearch.product" @input="setFilterSearch('product', $event.target.value)"
                         placeholder="🔍 Search product..." />
                </div>
                <label v-for="p in filteredProducts" :key="p" class="popup-option">
                  <input type="checkbox" :checked="selectedProducts.includes(p)" @change="toggleProductFilter(p)" />
                  <span>{{ p }}</span>
                </label>
                <div class="popup-empty" v-if="!filteredProducts.length">No matching products</div>
              </div>
            </div>

            <div class="filter-chip-wrap">
              <button class="filter-chip" :class="{ active: activeFilterChip === 'assignee' }"
                      @click.stop="toggleFilterChip('assignee')">
                Assignee
                <span class="chip-count" v-if="assigneesFilter.length">{{ assigneesFilter.length }}</span>
                <span class="chip-caret">▾</span>
              </button>
              <div v-if="activeFilterChip === 'assignee'" class="filter-popup" @click.stop>
                <div class="popup-head">
                  <span>Assignee</span>
                  <button class="popup-clear" @click="clearFilter('assigneesFilter')">Clear</button>
                </div>
                <div class="popup-search">
                  <input type="text" v-model="filterSearch.assignee" @input="setFilterSearch('assignee', $event.target.value)"
                         placeholder="🔍 Search assignee..." />
                </div>
                <label class="popup-option">
                  <input type="checkbox" :checked="assigneesFilter.includes('__unassigned__')"
                         @change="toggleAssigneeFilter('__unassigned__')" />
                  <span class="popup-notassigned">🚫 Not Assigned</span>
                </label>
                <label v-for="a in filteredAssignees" :key="a.uid" class="popup-option">
                  <input type="checkbox" :checked="assigneesFilter.includes(a.uid)" @change="toggleAssigneeFilter(a.uid)" />
                  <span class="popup-color-dot" :style="{ backgroundColor: getAssignColor(a.uid) }"></span>
                  <span>{{ a.name }}</span>
                </label>
                <div class="popup-empty" v-if="!filteredAssignees.length">No matching assignees</div>
              </div>
            </div>

            <div class="filter-chip-wrap">
              <button class="filter-chip" :class="{ active: activeFilterChip === 'sprint' }"
                      @click.stop="toggleFilterChip('sprint')">
                Sprint
                <span class="chip-count" v-if="sprintsFilter.length">{{ sprintsFilter.length }}</span>
                <span class="chip-caret">▾</span>
              </button>
              <div v-if="activeFilterChip === 'sprint'" class="filter-popup" @click.stop>
                <div class="popup-head">
                  <span>Sprint</span>
                  <button class="popup-clear" @click="clearFilter('sprintsFilter')">Clear</button>
                </div>
                <div class="popup-search">
                  <input type="text" v-model="filterSearch.sprint" @input="setFilterSearch('sprint', $event.target.value)"
                         placeholder="🔍 Search sprint..." />
                </div>
                <label class="popup-option">
                  <input type="checkbox" :checked="sprintsFilter.includes('__nosprint__')"
                         @change="toggleSprintFilter('__nosprint__')" />
                  <span class="popup-notassigned">🚫 Not in Sprint</span>
                </label>
                <label v-for="s in filteredSprints" :key="s" class="popup-option">
                  <input type="checkbox" :checked="sprintsFilter.includes(s)" @change="toggleSprintFilter(s)" />
                  <span>{{ s }}</span>
                </label>
                <div class="popup-empty" v-if="!filteredSprints.length">No matching sprints</div>
              </div>
            </div>

            <div class="filter-chip-wrap">
              <button class="filter-chip" :class="{ active: activeFilterChip === 'date' }"
                      @click.stop="toggleFilterChip('date')">
                Date
                <span class="chip-count" v-if="activeDateCount()">{{ activeDateCount() }}</span>
                <span class="chip-caret">▾</span>
              </button>
              <div v-if="activeFilterChip === 'date'" class="filter-popup" style="padding: 10px 12px;" @click.stop>
                <div class="popup-head">
                  <span>Date ranges</span>
                  <button class="popup-clear" @click="clearDateFilter">Clear</button>
                </div>
                <div v-for="f in DATE_FIELDS" :key="f.key" class="date-filter-row">
                  <div class="date-filter-label">{{ f.label }}</div>
                  <input type="date" class="compact-date"
                         :value="(dateFilter[f.key] || {}).from || ''"
                         @change="setDateFilter(f.key, 'from', $event.target.value)" />
                  <span class="date-filter-sep">–</span>
                  <input type="date" class="compact-date"
                         :value="(dateFilter[f.key] || {}).to || ''"
                         @change="setDateFilter(f.key, 'to', $event.target.value)" />
                </div>
                <div class="popup-empty" v-if="!DATE_FIELDS.some(f => dateRangeActive(f.key))">No range set (All dates)</div>
              </div>
            </div>

            <div class="filter-chip-wrap">
              <select v-model="blockerFilter" @change="updateBlockerFilter" class="filter-chip-select" title="Blocker filter">
                <option value="all">Blocker: All</option>
                <option value="blocked">🚫 Blocked</option>
                <option value="not_blocked">✅ Not Blocked</option>
              </select>
            </div>

            <div class="filter-chip-wrap">
              <select :value="sortMode" @change="setSortMode($event.target.value)" class="filter-chip-select" title="Sort order">
                <option value="reported">Sort: Reported (newest)</option>
                <option value="status">Sort: Status order</option>
              </select>
            </div>

            <div class="filter-chip-wrap">
              <select :value="parentFilter" @change="setParentFilter($event.target.value)" class="filter-chip-select" title="Parent filter">
                <option value="all">Parent: All</option>
                <option v-for="p in parentOptions" :key="p" :value="p">{{ p }}</option>
              </select>
            </div>
          </div>

          <span class="filter-label" style="margin-left: 10px;">Hide Statuses:</span>
          <label v-for="status in statusOrder" :key="status" class="filter-toggle">
            <input type="checkbox" :checked="hiddenStatuses.includes(status)" @change="toggleStatus(status)" />
            <span class="badge filter-badge" :style="{ backgroundColor: getStatusColor(status) }">{{ status }}</span>
          </label>
          <button class="filter-chip status-bulk" style="margin-left:6px;" @click="setAllStatuses(true)">Hide All</button>
          <button class="filter-chip status-bulk" @click="setAllStatuses(false)">Show All</button>
        </div>
        <div style="display: flex; gap: 15px; align-items: center;">
          <button @click="exportToExcel" title="Download current view as TSV (opens in Excel)" class="export-btn">📊 Export Excel</button>
          <button @click="fetchTasks()" :disabled="loading">
            {{ loading ? 'Refreshing...' : 'Refresh Tasks' }}
          </button>
          <button @click="logout" class="logout-btn">Logout</button>
          <span class="status-text">{{ fetchStatus }}</span>
        </div>
        <div class="user-auth-bar" v-if="activePage === 'tasks'">
          <span class="user-auth-label">👤 Taskmanager</span>
          <input v-model="userLoginData.username" type="text" placeholder="Username" class="user-auth-input" />
          <input v-model="userLoginData.password" type="password" placeholder="Password" class="user-auth-input" />
          <span v-if="userLoginError" class="worklog-msg err">{{ userLoginError }}</span>
        </div>
      </div>
    </header>

    <div v-if="activePage === 'tasks'">
      <div v-if="error" class="error">
        Error: {{ error }}
      </div>

      <div v-if="!taskToken && !loading" class="login-form">
        <span style="color:#6b7280;font-size:0.85rem;">Logging in...</span>
      </div>

      <div v-if="!flatTaskTree.length && tasks.length && !loading" class="empty-state">
        No tasks match the current filters ({{ tasks.length }} loaded)
      </div>
      <div v-if="!tasks.length && !loading" class="empty-state">
        {{ selectedProducts.length ? 'No tasks found' : 'Select at least one product to load tasks' }}
      </div>
      <div class="table-container" v-if="flatTaskTree.length">
        <table class="task-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Status</th>
            <th>ID</th>
            <th>Title</th>
            <th>Ass.</th>
            <th>Reported By</th>
            <th class="center">Blocker</th>
            <th>Sprint</th>
            <th>Taken</th>
            <th>Dev Done</th>
            <th>QA By</th>
            <th>QA Taken</th>
            <th class="center">Work</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="task in flatTaskTree" :key="task.taskID || task.id">
          <tr class="task-row" :class="{ deleted: task.isDeleted }">
            <td>
              <span class="product-badge" v-if="getTaskProduct(task)">
                {{ getTaskProduct(task) }}
              </span>
            </td>
            <td>
              <span class="badge" :style="{ backgroundColor: getStatusColor(getEffectiveStatus(task)), marginLeft: (task._depth * 20) + 'px'}">
                {{ getEffectiveStatus(task) }}
              </span>
            </td>
            <td>
              <a :href="'https://taskmanager.minipc.sismedika.biz.id/tasks/' + (task.taskID || task.id)" target="_blank" class="task-id">
                {{ task.taskID || task.id }}
              </a>
            </td>
            <td class="cell-title">
              <div class="scrollable-title" :style="{ paddingLeft: (task._depth * 20) + 'px' }">
                <a :href="'https://taskmanager.minipc.sismedika.biz.id/tasks/' + (task.taskID || task.id)"
                   target="_blank" class="task-link"
                   :class="{ 'task-link-sub': task._depth > 0 }"
                   title="Open task in TaskManager">
                  <span v-if="task._depth > 0" class="tree-branch">↳ </span>{{ task.title }}
                </a>
                <button class="copy-btn" @click="copyTask(task)" title="Copy ID | Title">📋</button>
              </div>
            </td>
            <td>
              <span class="task-assignee" v-if="getTaskAssignee(task)"
                    :style="{ backgroundColor: getUserColor(task) + '22', color: getUserColor(task), borderColor: getUserColor(task) + '44' }">
                {{ getUserName(task) }}
              </span>
              <span class="task-assignee unassigned" v-else>—</span>
            </td>
            <td class="cell-user">{{ userName(task.reportedByUserID) }}</td>
            <td class="center">
              <input type="checkbox"
                     :checked="customTags[task.taskID || task.id]?.isBlocker"
                     @change="e => updateCustomTag(task, 'isBlocker', e.target.checked)" />
            </td>
            <td>
              <input type="text" class="compact-input"
                     :value="customTags[task.taskID || task.id]?.sprint || ''"
                     @change="e => updateCustomTag(task, 'sprint', e.target.value)"
                     :readonly="userLoginData.username !== 'rajif'"
                     :title="userLoginData.username !== 'rajif' ? 'Read-only — only rajif can edit sprints' : ''"
                     placeholder="Sprint #" />
            </td>
            <td class="cell-date">{{ fmtDate(task.takenAt) }}</td>
            <td class="cell-date">{{ fmtDate(task.devDoneAt) }}</td>
            <td class="cell-user">{{ userName(task.qaTakenByUserID) }}</td>
            <td class="cell-date">{{ fmtDate(task.qaTakenAt) }}</td>
            <td class="center">
              <button class="worklog-btn" @click="toggleWorklog(task)"
                      :class="{ active: worklogTaskId === (task.taskID || task.id) }"
                      title="Log work">
                ⏱
              </button>
            </td>
          </tr>
          <!-- inline worklog form row -->
          <tr v-if="worklogTaskId === (task.taskID || task.id)" class="worklog-row">
            <td colspan="13">
              <div class="worklog-inline">
                <input v-model="worklogForm.description" type="text" placeholder="Description..." class="worklog-input" />
                <input v-model="worklogForm.date" type="date" class="worklog-input worklog-date" />
                <input v-model="worklogForm.hours" type="number" min="0.5" step="0.5" placeholder="Hours" class="worklog-input worklog-hours" />
                <button class="worklog-submit" @click="submitWorklog(task)" :disabled="worklogSubmitting || !worklogForm.description.trim() || !worklogForm.hours">
                  {{ worklogSubmitting ? '...' : 'Send' }}
                </button>
                <button class="worklog-cancel" @click="worklogTaskId = null">✕</button>
                <span v-if="worklogMsg.taskId === (task.taskID || task.id)" class="worklog-msg" :class="{ ok: worklogMsg.ok, err: !worklogMsg.ok }">
                  {{ worklogMsg.text }}
                </span>
              </div>
            </td>
          </tr>
          </template>
        </tbody>
      </table>
    </div>
    </div>

    <div v-if="activePage === 'stats'">
      <StatsPage :tasks="flatTaskTree" :filter-summary="filterSummary" />
    </div>

    <div v-if="activePage === 'users'">
      <UsersPage :tasks="tasks" :user-names="userNames" :update-user-name="updateUserName" />
    </div>
  </div>
</template>

<style>
.update-banner {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 9999;
  background: #2563eb;
  color: white;
  text-align: center;
  padding: 8px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
}
.update-banner:hover { background: #1d4ed8; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background: #f3f4f6;
  color: #1f2937;
  margin: 0;
  padding: 20px;
  padding-top: 40px; /* room for update banner */
}

.container {
  margin: 0 auto;
  background: white;
  padding: 30px;
  border-radius: 8px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

header {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 15px;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 20px;
  margin-bottom: 20px;
}

h1 { margin: 0; font-size: 1.5rem; }

.nav-tabs { display: flex; gap: 2px; margin-bottom: 10px; }
.nav-tab {
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-bottom: none;
  padding: 6px 16px;
  font-size: 0.85rem;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
  border-radius: 6px 6px 0 0;
}
.nav-tab.active { background: white; color: #1f2937; border-color: #d1d5db; }
.nav-tab:not(.active):hover { background: #e5e7eb; }

.actions {
  display: flex;
  flex-direction: column;
  gap: 15px;
  width: 100%;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  background: #f9fafb;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.filter-search {
  padding: 5px 10px;
  border-radius: 4px;
  border: 1px solid #d1d5db;
  font-size: 0.85rem;
  width: 220px;
}

.filter-label {
  font-weight: 500;
  font-size: 0.9rem;
  margin-right: 5px;
}

.filter-chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.filter-chip-wrap {
  position: relative;
  display: inline-block;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: white;
  border: 1px solid #d1d5db;
  color: #374151;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.filter-chip:hover { border-color: #2563eb; color: #2563eb; background: #eff6ff; }
.filter-chip.active { border-color: #2563eb; color: #2563eb; background: #eff6ff; }

.chip-count {
  background: #2563eb;
  color: white;
  border-radius: 8px;
  font-size: 0.68rem;
  padding: 0 5px;
  line-height: 14px;
  font-weight: 700;
}
.chip-caret { font-size: 0.7rem; color: #9ca3af; }

.filter-chip-select {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #d1d5db;
  font-size: 0.82rem;
  background: white;
  color: #374151;
  font-weight: 500;
  cursor: pointer;
}

/* --- Excel/Sheets-style filter popup --- */
.filter-popup {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 100;
  min-width: 200px;
  max-width: 280px;
  max-height: 320px;
  overflow-y: auto;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 6px 0;
}

.popup-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: #6b7280;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 4px;
  position: sticky;
  top: 0;
  background: white;
}

.popup-clear {
  background: transparent;
  color: #2563eb;
  border: none;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}
.popup-clear:hover { text-decoration: underline; }

.popup-search {
  padding: 4px 8px 8px;
  position: sticky;
  top: 26px;
  background: white;
  z-index: 1;
}
.popup-search input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  font-size: 0.8rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  outline: none;
}
.popup-search input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.popup-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  font-size: 0.82rem;
  color: #374151;
  cursor: pointer;
  white-space: nowrap;
}
.popup-option:hover { background: #f3f4f6; }
.popup-option input[type="checkbox"] { margin: 0; accent-color: #2563eb; }

.popup-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.popup-notassigned {
  color: #9ca3af;
  font-style: italic;
}

.popup-empty {
  padding: 8px 12px;
  font-size: 0.78rem;
  color: #9ca3af;
}

.product-select {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #d1d5db;
  font-size: 0.85rem;
  background: white;
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85rem;
  color: #4b5563;
  cursor: pointer;
}

.filter-badge {
  font-size: 0.7rem;
  padding: 2px 6px;
  min-width: auto;
}

button {
  background: #2563eb;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
}
.logout-btn { background: #dc2626; }
.export-btn { background: #16a34a; }
.export-btn:hover { background: #15803d; }
button:hover:not(:disabled) { background: #1d4ed8; }
.logout-btn:hover { background: #b91c1c; }
button:disabled { opacity: 0.5; cursor: not-allowed; }

.status-text { margin-left: 10px; font-size: 0.875rem; color: #6b7280; }
.error { color: #ef4444; padding: 10px; background: #fee2e2; border-radius: 4px; margin-bottom: 20px; }

.login-form {
  display: flex;
  gap: 10px;
  align-items: center;
}
input {
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}

.table-container {
  overflow-x: auto;
  margin-top: 10px;
  background: white;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.task-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.task-table th {
  text-align: left;
  background: #f9fafb;
  padding: 10px 12px;
  border-bottom: 2px solid #e5e7eb;
  white-space: nowrap;
  font-weight: 600;
  color: #4b5563;
}

.task-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: middle;
}

.task-row:hover {
  background: #f3f4f6;
}
.task-row.deleted td { text-decoration: line-through; color: #9ca3af; }
.task-row.deleted a { color: #9ca3af; }
.task-row.deleted .badge { opacity: 0.6; }

.badge {
  font-size: 0.70rem;
  font-weight: 600;
  padding: 3px 6px;
  border-radius: 4px;
  color: white;
  display: inline-block;
  text-align: center;
  min-width: 90px;
}

.task-id { 
  font-family: monospace; 
  color: #2563eb; 
  font-size: 0.85rem; 
  text-decoration: none;
}
.task-id:hover { text-decoration: underline; }

/* Title cell: the whole title is now the link to the task */
.task-link { color: #111827; text-decoration: none; }
.task-link:hover { color: #2563eb; text-decoration: underline; }
.task-link-sub { color: #374151; }

.cell-title {
  max-width: 300px;
  min-width: 250px;
}

.scrollable-title {
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: thin;
  padding-bottom: 4px;
  color: #111827;
  font-weight: 500;
  position: relative;
}
.scrollable-title::-webkit-scrollbar { height: 4px; }
.scrollable-title::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }

.copy-btn {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 0.7rem;
  cursor: pointer;
  opacity: 0;
  z-index: 1;
  line-height: 1;
}
.scrollable-title:hover .copy-btn { opacity: 1; }
.copy-btn:hover { background: #e5e7eb; }

.tree-branch { color: #9ca3af; margin-right: 4px; }

.task-assignee {
  font-size: 0.75rem;
  color: #6b7280;
  background: #e5e7eb;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
.task-assignee.unassigned {
  background: transparent;
  color: #9ca3af;
  border: 1px dashed #d1d5db;
}

.product-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: #1d4ed8;
  background: #dbeafe;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.center { text-align: center; }

.compact-date {
  padding: 4px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #374151;
}

/* --- date-range filter popup rows --- */
.date-filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.date-filter-label {
  width: 72px;
  flex: none;
  font-size: 0.8rem;
  color: #374151;
  font-weight: 500;
}
.date-filter-sep { color: #9ca3af; }
.cell-date { font-size: 0.78rem; color: #374151; white-space: nowrap; }
.cell-user { font-size: 0.78rem; color: #374151; white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis; }

.compact-input {
  padding: 4px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #374151;
  width: 70px;
}
.compact-input[readonly] {
  background: #f3f4f6;
  color: #6b7280;
  cursor: not-allowed;
}

/* --- worklog inline form --- */
.worklog-btn {
  background: transparent;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  color: #6b7280;
  transition: all 0.15s;
}
.worklog-btn:hover { background: #f3f4f6; border-color: #2563eb; color: #2563eb; }
.worklog-btn.active { background: #eff6ff; border-color: #2563eb; color: #2563eb; }

.worklog-row td {
  background: #f9fafb;
  padding: 8px 12px;
}

.worklog-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.worklog-input {
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.82rem;
  color: #1f2937;
}
.worklog-input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 1px #2563eb; }
.worklog-date { width: 135px; }
.worklog-hours { width: 70px; }

.worklog-submit {
  background: #2563eb;
  color: white;
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.worklog-submit:hover:not(:disabled) { background: #1d4ed8; }
.worklog-submit:disabled { opacity: 0.5; cursor: not-allowed; }

.worklog-cancel {
  background: transparent;
  border: 1px solid #d1d5db;
  color: #6b7280;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.82rem;
}
.worklog-cancel:hover { background: #fee2e2; color: #dc2626; border-color: #fca5a5; }

.worklog-msg {
  font-size: 0.78rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
}
.worklog-msg.ok { color: #16a34a; background: #dcfce7; }
.worklog-msg.err { color: #dc2626; background: #fee2e2; }

/* --- user auth bar --- */
.user-auth-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  font-size: 0.82rem;
}
.user-auth-label {
  color: #92400e;
  font-weight: 500;
}
.user-auth-input {
  padding: 3px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.82rem;
  width: 120px;
}
.user-auth-btn {
  background: #2563eb;
  color: white;
  border: none;
  padding: 3px 12px;
  border-radius: 4px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
}
.user-auth-btn:hover:not(:disabled) { background: #1d4ed8; }
.user-auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
