<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  activeWeek: { type: String, required: true },
  planEntries: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:activeWeek', 'remove', 'save'])
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = value => { const d = new Date(`${value}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDate(d) }
const today = localDate(new Date())
const week = computed({ get: () => props.activeWeek, set: value => emit('update:activeWeek', monday(value)) })
const plans = computed(() => props.planEntries)
const query = ref('') // ponytail: retained no-op state removed with add controls below.
const error = ref('')
const saving = ref({})

const fmtTask = t => `${t.taskID || t.id} — ${t.title || ''}`
const taskMap = computed(() => Object.fromEntries(props.tasks.map(t => [t.taskID || t.id, t])))
const rows = computed(() => Object.values(plans.value).map(p => ({ ...p, task: taskMap.value[p.taskID] }))
  .sort((a, b) => (a.execDate || '9999').localeCompare(b.execDate || '9999') || a.taskID.localeCompare(b.taskID)))
const weekEnd = computed(() => { const d = new Date(`${week.value}T12:00:00`); d.setDate(d.getDate() + 6); return localDate(d) })

// Entries are loaded and added by App.vue, so Tasks and Weekly Plan share one active week.
watch(week, () => { error.value = '' })
const save = async p => {
  saving.value[p.taskID] = true
  try {
    const r = await fetch('/api/week-plan', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
    if (!r.ok) throw new Error()
    emit('save', p)
  } catch { error.value = `Could not save ${p.taskID}` }
  finally { delete saving.value[p.taskID] }
}
const remove = async p => {
  const r = await fetch(`/api/week-plan/${encodeURIComponent(p.taskID)}?week=${week.value}`, { method: 'DELETE' })
  if (!r.ok) error.value = `Could not remove ${p.taskID}`
  else emit('remove', p.taskID)
}
// Ponytail: shows latest completed gate. Add qaDoneAt priority when QA tracking needed.
const doneRaw = task => task?.qcDoneAt?.slice(0, 10) || task?.devDoneAt?.slice(0, 10) || ''
// Only fill when the done date falls inside the active weekly range (Mon-Sun);
// stale dates from a previous back-and-forth cycle stay blank.
const taskDoneDate = task => { const d = doneRaw(task); return d && d >= week.value && d <= weekEnd.value ? d : '' }
// Done in this week but never planned: same ranged date, taskID not in plan entries.
const unplannedDone = computed(() => props.tasks
  .filter(t => { const id = t.taskID || t.id; return id && !plans.value[id] && !!taskDoneDate(t) })
  .sort((a, b) => (doneRaw(a) || '').localeCompare(doneRaw(b) || '') || (a.taskID || a.id || '').localeCompare(b.taskID || b.id || '')))
const shiftWeek = days => { const d = new Date(`${week.value}T12:00:00`); d.setDate(d.getDate() + days); week.value = localDate(d) }
const nextWeek = () => shiftWeek(7)
const prevWeek = () => shiftWeek(-7)

const exportPlan = () => {
  // Task deliberately exports title only; task IDs remain available in the UI/link.
  const data = [...rows.value.map(p => ({
    Project: p.task?.productCode || '',
    Task: p.task?.title || '',
    'Execution Date': p.execDate,
    Priority: p.priority,
    'Is AdHoc': p.isAdhoc ? 'Y' : 'N',
    'Carry Over': p.carryOver ? 'Y' : 'N',
    'First Planned': p.firstPlanned,
    'Blocker / Issue': p.blocker,
    Status: p.status,
    'Done Date': taskDoneDate(p.task),
  })), ...unplannedDone.value.map(t => ({
    Project: t.productCode || '',
    Task: t.title || '',
    'Execution Date': '',
    Priority: '',
    'Is AdHoc': '',
    'Carry Over': '',
    'First Planned': '',
    'Blocker / Issue': 'Not planned',
    Status: 'Done',
    'Done Date': taskDoneDate(t),
  }))]
  const headers = Object.keys(data[0] || {})
  const esc = v => String(v ?? '').replace(/[\t\r\n]/g, ' ')
  const tsv = [headers.join('\t'), ...data.map(row => headers.map(h => esc(row[h])).join('\t'))].join('\n')
  const url = URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `weekly-plan_${week.value}.tsv` })
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="page">
    <div class="head"><h2>Current Active Weekly Plan</h2><button @click="prevWeek">← Previous week</button><input v-model="week" type="date" title="Any date selects that week's Monday"><button @click="nextWeek">Next week →</button><strong>{{ week }} (Monday)</strong><span>– {{ weekEnd }}</span><button class="export" :disabled="!rows.length && !unplannedDone.length" @click="exportPlan">Export Excel</button></div>
    <p class="hint">This plan always starts on Monday. Add tasks from the Tasks list using “+ Plan” or “+ Ad-hoc”; maintain execution, status and blockers here day-by-day.</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="!props.tasks.length" class="hint">Load a product on the Tasks tab first, so its tasks can be planned.</p>
    <table v-if="rows.length"><thead><tr><th>Project</th><th>Task</th><th>Execution</th><th>Priority</th><th>Ad-hoc</th><th>Carry over</th><th>First planned</th><th>Blocker / Issue</th><th>Status</th><th>Done</th><th></th></tr></thead><tbody>
      <tr v-for="p in rows" :key="p.taskID" :class="{ adhocrow: p.isAdhoc }"><td>{{ p.task?.productCode || '—' }}</td><td><a :href="'https://taskmanager.minipc.sismedika.biz.id/tasks/' + p.taskID" target="_blank">{{ p.taskID }}</a><br><small>{{ p.task?.title || 'Task not loaded' }}</small></td><td><input v-model="p.execDate" type="date" @change="save(p)"></td><td><select v-model="p.priority" @change="save(p)"><option>High</option><option>Medium</option><option>Normal</option><option>Low</option></select></td><td><input v-model="p.isAdhoc" type="checkbox" @change="save(p)"></td><td><input v-model="p.carryOver" type="checkbox" @change="save(p)"></td><td><input v-model="p.firstPlanned" type="date" @change="save(p)"></td><td><input v-model="p.blocker" placeholder="Issue…" @change="save(p)"></td><td><select v-model="p.status" @change="save(p)"><option>Not Started</option><option>In Progress</option><option>Blocked</option><option>Done</option><option>Declined</option></select></td><td>{{ taskDoneDate(p.task) }}</td><td><button class="remove" :disabled="saving[p.taskID]" @click="remove(p)">×</button></td></tr>
    </tbody></table><p v-else class="hint">No task planned for this week.</p>
    <h3 v-if="unplannedDone.length">Done this week, not planned ({{ unplannedDone.length }})</h3>
    <table v-if="unplannedDone.length"><thead><tr><th>Project</th><th>Task</th><th>Done</th></tr></thead><tbody>
      <tr v-for="t in unplannedDone" :key="t.taskID || t.id"><td>{{ t.productCode || '—' }}</td><td>{{ t.taskID || t.id }}<br><small>{{ t.title || '' }}</small></td><td>{{ taskDoneDate(t) }}</td></tr>
    </tbody></table>
  </div>
</template>

<style scoped>
.page { padding:10px 0; }.head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px }.head h2{margin:0}.head span,.hint,small{color:#6b7280;font-size:.82rem}.hint{margin:6px 0 12px}.export{background:#16a34a}.export:hover:not(:disabled){background:#15803d}.error{color:#b91c1c}table{width:100%;border-collapse:collapse;font-size:.8rem}th,td{border:1px solid #e5e7eb;padding:5px;text-align:left;vertical-align:top}th{background:#f9fafb}input,select{max-width:140px;padding:4px}.adhocrow{background:#fff7ed}.remove{background:#dc2626}small{word-break:break-word}
</style>
