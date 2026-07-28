<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  userNames: { type: Object, default: () => ({}) },
  updateUserName: { type: Function, default: () => {} },
})

const search = ref('')

const allUserIds = computed(() => {
  const set = new Set()
  const add = (v) => { if (v && v.trim()) set.add(v.trim()) }
  props.tasks.forEach(t => {
    add(t.assigneeUserID)
    add(t.preAssignedUserID)
    add(t.takenByUserID)
    add(t.qaTakenByUserID)
    add(t.qcTakenByUserID)
    add(t.reportedByUserID)
    add(t.devDoneProxyUserID)
    add(t.onHoldSetByUserID)
  })
  return Array.from(set).sort()
})

const filteredIds = computed(() => {
  if (!search.value) return allUserIds.value
  const q = search.value.toLowerCase()
  return allUserIds.value.filter(id => {
    const name = (props.userNames[id] || '').toLowerCase()
    return id.toLowerCase().includes(q) || name.includes(q)
  })
})

const copyId = (uid) => {
  navigator.clipboard.writeText(uid)
}

const setName = (uid, name) => {
  props.updateUserName(uid, name)
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2>User IDs</h2>
      <span class="page-subtitle">{{ allUserIds.length }} unique IDs from loaded tasks</span>
    </div>

    <div class="search-bar">
      <input v-model="search" placeholder="filter by ID or name..." class="uid-search" />
      <span class="result-count">{{ filteredIds.length }} / {{ allUserIds.length }}</span>
    </div>

    <div v-if="!filteredIds.length" class="empty-state" style="padding:30px;text-align:center;color:#9ca3af;">
      {{ allUserIds.length ? 'No IDs match your filter.' : 'No tasks loaded yet. Go to Tasks page, select a product, then come back here.' }}
    </div>

    <div v-else class="uid-table-wrap">
      <table class="uid-table">
        <thead>
          <tr><th>User ID</th><th>Name</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="uid in filteredIds" :key="uid">
            <td><code>{{ uid }}</code></td>
            <td>
              <input class="name-input" :value="userNames[uid] || ''" @change="e => setName(uid, e.target.value)" placeholder="set name..." />
            </td>
            <td class="actions-cell">
              <button class="copy-btn" @click="copyId(uid)" title="Copy ID">📋</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.page { padding: 10px 0; }
.page-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 15px; }
.page-header h2 { margin: 0; font-size: 1.2rem; }
.page-subtitle { font-size: 0.8rem; color: #6b7280; }
.search-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 15px; }
.uid-search {
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  flex: 1;
  font-size: 0.9rem;
  max-width: 400px;
}
.result-count { font-size: 0.8rem; color: #6b7280; white-space: nowrap; }
.uid-table-wrap { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
.uid-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.uid-table th {
  text-align: left;
  background: #f9fafb;
  padding: 8px 12px;
  border-bottom: 2px solid #e5e7eb;
  font-weight: 600;
  color: #4b5563;
}
.uid-table td {
  padding: 6px 12px;
  border-bottom: 1px solid #e5e7eb;
  vertical-align: middle;
}
.uid-table tr:hover { background: #f3f4f6; }
.uid-table code { font-family: monospace; font-size: 0.82rem; color: #1f2937; }
.name-input {
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.82rem;
  width: 200px;
}
.name-input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
.actions-cell { text-align: right; }
.copy-btn {
  background: none; border: 1px solid transparent; cursor: pointer; padding: 2px 6px; font-size: 0.8rem;
  border-radius: 3px; opacity: 0.4;
}
.uid-table tr:hover .copy-btn { opacity: 1; }
.copy-btn:hover { background: #e5e7eb; border-color: #d1d5db; }
</style>
