<script setup>
import { ref, onMounted, computed } from 'vue'
import UsersPage from './UsersPage.vue'

// --- version / update check ---
const BUILD_ID = Date.now() // set at build time, embedded in JS bundle
const newBuildAvailable = ref(false)

onMounted(async () => {
  if (!taskToken.value) {
    await loginAndFetch()
  }
  await loadUserNames()
  if (taskToken.value) {
    await fetchProducts()
    if (!selectedProduct.value && products.value.length) {
      selectedProduct.value = products.value.map(p => p.code || p.productCode || p.name).sort()[0]
      localStorage.setItem('task_selected_product', selectedProduct.value)
    }
    fetchTasks(searchQuery.value)
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
    
    await fetchProducts()
    // auto-select first product if none selected yet
    if (!selectedProduct.value && products.value.length) {
      selectedProduct.value = products.value.map(p => p.code || p.productCode || p.name).sort()[0]
      localStorage.setItem('task_selected_product', selectedProduct.value)
    }
    await fetchTasks('')
  } catch (err) {
    error.value = err.message
    loading.value = false
  }
}

const fetchTasks = async (search) => {
  if (!taskToken.value) return loginAndFetch()
  if (!selectedProduct.value) return
  
  loading.value = true
  fetchStatus.value = 'Fetching tasks...'
  error.value = null
  
  try {
    let allItems = []
    let currentPage = 1
    const pageSize = 100 // API hard limit
    
    while (true) {
      let url = `/api/v1/tasks?pageSize=${pageSize}&page=${currentPage}`
      if (search) url += `&search=${encodeURIComponent(search)}`
      if (selectedProduct.value) url += `&product=${encodeURIComponent(selectedProduct.value)}`
      
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${taskToken.value}` }
      })
      
      if (res.status === 401) {
        taskToken.value = ''
        localStorage.removeItem('task_token')
        return loginAndFetch()
      }
      
      if (!res.ok) throw new Error(`Failed to fetch tasks (Page ${currentPage})`)
      
      const data = await res.json()
      const fetchedItems = data.items || []
      
      allItems = allItems.concat(fetchedItems)
      
      // If we got fewer items than the pageSize, we've reached the last page
      if (fetchedItems.length < pageSize || allItems.length >= (data.total || 0)) {
        break
      }
      
      currentPage++
      fetchStatus.value = `Fetching tasks (Page ${currentPage})...`
    }
    
    tasks.value = allItems
    fetchStatus.value = `Loaded ${tasks.value.length} tasks`
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

const getUserName = (task) => {
  const uid = task.assigneeUserID || task.preAssignedUserID || task.takenByUserID
  return uid ? (userNames.value[uid] || uid) : ''
}

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

// Load persisted filters or use defaults
const savedStatuses = localStorage.getItem('task_hidden_statuses')
const hiddenStatuses = ref(savedStatuses ? JSON.parse(savedStatuses) : ['QC_DONE', 'QA_DONE', 'DELETED'])
const selectedProduct = ref(localStorage.getItem('task_selected_product') || '')
const assigneeFilter = ref(localStorage.getItem('task_assignee_filter') || '')
const searchQuery = ref(localStorage.getItem('task_search_query') || '')
const blockerFilter = ref(localStorage.getItem('task_blocker_filter') || 'all')

const searchTasks = () => {
  searchQuery.value = searchQuery.value.trim()
  localStorage.setItem('task_search_query', searchQuery.value)
  fetchTasks(searchQuery.value)
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

const customTags = ref(JSON.parse(localStorage.getItem('task_custom_tags') || '{}'))

const saveCustomTags = () => {
  localStorage.setItem('task_custom_tags', JSON.stringify(customTags.value))
}

const copyTask = (task) => {
  const id = task.taskID || task.id
  navigator.clipboard.writeText(`${id} | ${task.title}`)
}

const updateCustomTag = (task, field, value) => {
  const id = task.taskID || task.id
  if (!customTags.value[id]) {
    customTags.value[id] = { isBlocker: false, inDevDate: '', devDoneDate: '' }
  }
  customTags.value[id][field] = value
  
  // Clean up if all empty
  if (!customTags.value[id].isBlocker && !customTags.value[id].inDevDate && !customTags.value[id].devDoneDate) {
    delete customTags.value[id]
  }
  
  saveCustomTags()
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

const toggleStatus = (status) => {
  const idx = hiddenStatuses.value.indexOf(status)
  if (idx === -1) hiddenStatuses.value.push(status)
  else hiddenStatuses.value.splice(idx, 1)
  
  localStorage.setItem('task_hidden_statuses', JSON.stringify(hiddenStatuses.value))
}

const updateProductFilter = () => {
  localStorage.setItem('task_selected_product', selectedProduct.value)
  if (selectedProduct.value) {
    tasks.value = []
    fetchTasks(searchQuery.value)
  } else {
    tasks.value = []
  }
}

const updateAssigneeFilter = () => {
  localStorage.setItem('task_assignee_filter', assigneeFilter.value)
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

const taskTree = computed(() => {
  if (!tasks.value.length) return []
  
  const taskMap = {}
  tasks.value.forEach(t => {
    const id = t.taskID || t.id
    taskMap[id] = { ...t, children: [] }
  })
  
  const roots = []
  
  Object.values(taskMap).forEach(t => {
    if (t.parentTaskID && taskMap[t.parentTaskID]) {
      taskMap[t.parentTaskID].children.push(t)
    } else {
      roots.push(t)
    }
  })
  
  // Sort children, and apply filtering if needed
  Object.values(taskMap).forEach(t => {
    t.children = t.children
      .filter(child => !selectedProduct.value || child.productCode === selectedProduct.value)
      .sort((a, b) => getStatusVal(a.status) - getStatusVal(b.status))
  })
  
  // Helper to check if a node or any of its descendants should be visible
  const isVisible = (node) => {
    // If it doesn't match the product filter, hide it and all children
    if (selectedProduct.value && node.productCode && node.productCode !== selectedProduct.value) {
      return false;
    }
    
    // Filter children first (needed for all downstream filters)
    node.children = node.children.filter(child => isVisible(child))
    
    // If assignee filter is active
    if (assigneeFilter.value) {
      const nodeAssignee = node.assigneeUserID || node.preAssignedUserID || node.takenByUserID || ''
      const selfMatch = nodeAssignee === assigneeFilter.value || (!nodeAssignee && assigneeFilter.value === '__unassigned__')
      // Keep node if self matches OR any child matches
      if (!selfMatch && node.children.length === 0) return false
    }
    
    // If blocker filter is active
    if (blockerFilter.value === 'blocked') {
      const selfBlocker = customTags.value[node.taskID || node.id]?.isBlocker
      const childHasBlocker = node.children.length > 0
      if (!selfBlocker && !childHasBlocker) return false
    }
    if (blockerFilter.value === 'not_blocked') {
      const selfBlocker = customTags.value[node.taskID || node.id]?.isBlocker
      if (selfBlocker) return false
    }
    
    // Check hidden statuses
    const effectiveStatus = getEffectiveStatus(node)
    const nodeVisible = !hiddenStatuses.value.includes(effectiveStatus)
    
    return nodeVisible || node.children.length > 0
  }
  
  return roots
    .filter(t => isVisible(t))
    .sort((a, b) => getStatusVal(a.status) - getStatusVal(b.status))
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
        <button class="nav-tab" :class="{ active: activePage === 'users' }" @click="activePage='users'">Users</button>
      </div>
      <div class="actions" v-if="activePage === 'tasks'">
        <div class="filters">
          <span class="filter-label">Product:</span>
          <select v-model="selectedProduct" @change="updateProductFilter" class="product-select">
            <option value="">All Products</option>
            <option v-for="prod in availableProducts" :key="prod" :value="prod">
              {{ prod }}
            </option>
          </select>

          <span class="filter-label" style="margin-left:4px;">Blocker:</span>
          <select v-model="blockerFilter" @change="updateBlockerFilter" class="product-select" style="max-width:140px;">
            <option value="all">All</option>
            <option value="blocked">🚫 Blocked</option>
            <option value="not_blocked">✅ Not Blocked</option>
          </select>

          <span class="filter-label">Assignee:</span>
          <select v-model="assigneeFilter" @change="updateAssigneeFilter" class="product-select" style="max-width:200px;">
            <option value="">All</option>
            <option v-for="a in availableAssignees" :key="a.uid" :value="a.uid" :style="{ borderLeft: '4px solid ' + getAssignColor(a.uid) }">
              {{ a.name }}
            </option>
          </select>

          <span class="filter-label">ID/Title:</span>
          <input type="text" v-model="searchQuery" @keydown="handleSearchKeydown" placeholder="search keyword..." style="padding:4px 8px;font-size:0.85rem;border:1px solid #d1d5db;border-radius:4px;width:180px" />

          <span class="filter-label" style="margin-left: 10px;">Hide Statuses:</span>
          <label v-for="status in statusOrder" :key="status" class="filter-toggle">
            <input type="checkbox" :checked="hiddenStatuses.includes(status)" @change="toggleStatus(status)" />
            <span class="badge filter-badge" :style="{ backgroundColor: getStatusColor(status) }">{{ status }}</span>
          </label>
        </div>
        <div style="display: flex; gap: 15px; align-items: center;">
          <button @click="fetchTasks(searchQuery)" :disabled="loading">
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

      <div v-if="!selectedProduct" class="empty-state">Select a product to load tasks</div>
      <div class="table-container" v-if="flatTaskTree.length">
        <table class="task-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>ID</th>
            <th>Title</th>
            <th>Ass.</th>
            <th class="center">Blocker</th>
            <th>In Dev</th>
            <th>Dev Done</th>
            <th class="center">Work</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="task in flatTaskTree" :key="task.taskID || task.id">
          <tr class="task-row" :class="{ deleted: task.isDeleted }">
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
                <button class="copy-btn" @click="copyTask(task)" title="Copy ID | Title">📋</button>
                <div style="display: flex;"><span v-if="task._depth > 0" class="tree-branch">↳ </span><div>{{ task.title }}</div></div>
              </div>
            </td>
            <td>
              <span class="task-assignee" v-if="task.assigneeUserID || task.preAssignedUserID || task.takenByUserID"
                    :style="{ backgroundColor: getUserColor(task) + '22', color: getUserColor(task), borderColor: getUserColor(task) + '44' }">
                {{ getUserName(task) }}
              </span>
            </td>
            <td class="center">
              <input type="checkbox"
                     :checked="customTags[task.taskID || task.id]?.isBlocker"
                     @change="e => updateCustomTag(task, 'isBlocker', e.target.checked)" />
            </td>
            <td>
              <input type="date" class="compact-date"
                     :value="customTags[task.taskID || task.id]?.inDevDate || ''"
                     @change="e => updateCustomTag(task, 'inDevDate', e.target.value)" />
            </td>
            <td>
              <input type="date" class="compact-date"
                     :value="customTags[task.taskID || task.id]?.devDoneDate || ''"
                     @change="e => updateCustomTag(task, 'devDoneDate', e.target.value)" />
            </td>
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
            <td colspan="8">
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

.filter-label {
  font-weight: 500;
  font-size: 0.9rem;
  margin-right: 5px;
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

.center { text-align: center; }

.compact-date {
  padding: 4px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #374151;
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