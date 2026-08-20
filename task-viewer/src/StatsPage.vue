<script setup>
import { computed } from 'vue'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  filterSummary: { type: String, default: '' },
})

const now = new Date()
const dateLabel = now.toLocaleString('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const STATUS_COLORS = {
  REPORTED: '#6b7280',
  IN_DEV: '#3b82f6',
  DEV_DONE: '#8b5cf6',
  QA_IN_PROGRESS: '#f59e0b',
  QA_DONE: '#d97706',
  QC_IN_PROGRESS: '#06b6d4',
  QC_DONE: '#10b981',
  HOLD: '#ea580c',
  DELETED: '#dc2626',
}
const STATUS_ORDER = ['REPORTED', 'IN_DEV', 'DEV_DONE', 'QA_IN_PROGRESS', 'QA_DONE', 'QC_IN_PROGRESS', 'QC_DONE', 'HOLD', 'DELETED']

const getEffectiveStatus = (t) => (t.isDeleted ? 'DELETED' : t.isOnHold ? 'HOLD' : t.status || 'UNKNOWN')
const getAssignee = (t) => t.assigneeUserID || t.preAssignedUserID || t.takenByUserID || ''

const total = computed(() => props.tasks.length)

const statusCounts = computed(() => {
  const map = {}
  props.tasks.forEach(t => {
    const s = getEffectiveStatus(t)
    map[s] = (map[s] || 0) + 1
  })
  return map
})

const statusRows = computed(() => {
  const counts = statusCounts.value
  const t = total.value
  const known = STATUS_ORDER.map(s => ({ status: s, count: counts[s] || 0 }))
  const unknown = Object.keys(counts).filter(s => !STATUS_ORDER.includes(s))
  const all = known.concat(unknown.map(s => ({ status: s, count: counts[s] })))
  return all
    .filter(r => r.count > 0)
    .map(r => ({ ...r, pct: t ? Math.round((r.count / t) * 100) : 0 }))
})

const assigned = computed(() => props.tasks.filter(t => getAssignee(t)).length)
const unassigned = computed(() => props.tasks.filter(t => !getAssignee(t)).length)
const assignedPct = computed(() => (total.value ? Math.round((assigned.value / total.value) * 100) : 0))
const unassignedPct = computed(() => 100 - assignedPct.value)

const perStatusAssignee = computed(() => {
  return statusRows.value.map(r => {
    const inStatus = props.tasks.filter(t => getEffectiveStatus(t) === r.status)
    const a = inStatus.filter(t => getAssignee(t)).length
    return { ...r, assigned: a, unassigned: inStatus.length - a }
  })
})

// Team status comparison — Dev vs QA
const TEAM_DEFS = [
  { team: 'Dev',   color: '#2563eb', statuses: ['REPORTED', 'HOLD', 'IN_DEV'] },
  { team: 'QA',    color: '#f59e0b', statuses: ['DEV_DONE', 'QA_IN_PROGRESS'] },
]
const teamStats = computed(() => {
  return TEAM_DEFS.map(def => {
    const members = def.statuses.map(status => {
      const list = props.tasks.filter(t => getEffectiveStatus(t) === status)
      return {
        status,
        color: STATUS_COLORS[status] || '#9ca3af',
        count: list.length,
        pct: total.value ? Math.round((list.length / total.value) * 100) : 0,
        assigned: list.filter(t => getAssignee(t)).length,
        unassigned: list.filter(t => !getAssignee(t)).length,
      }
    })
    const teamCount = members.reduce((sum, m) => sum + m.count, 0)
    return {
      team: def.team,
      color: def.color,
      count: teamCount,
      pct: total.value ? Math.round((teamCount / total.value) * 100) : 0,
      members,
    }
  })
})
const teamTotal = computed(() => teamStats.value.reduce((sum, t) => sum + t.count, 0))
</script>

<template>
  <div class="stats-page">
    <div class="stats-date">📅 {{ dateLabel }}</div>
    <div v-if="filterSummary" class="stats-filters">🎛 {{ filterSummary }}</div>
    <div v-if="!tasks.length" class="stats-empty">No tasks match the current filters.</div>

    <template v-else>
      <div class="stats-cards">
        <div class="stat-card">
          <div class="stat-value">{{ total }}</div>
          <div class="stat-label">Total Tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#2563eb;">{{ assigned }}</div>
          <div class="stat-label">Assigned</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#9ca3af;">{{ unassigned }}</div>
          <div class="stat-label">Not Assigned</div>
        </div>
      </div>

      <!-- Assigned vs Not Assigned split -->
      <div class="stats-section">
        <h3>Assignee Split</h3>
        <div class="split-bar">
          <div class="split-seg" :style="{ width: assignedPct + '%', background: '#2563eb' }" :title="'Assigned: ' + assigned + ' (' + assignedPct + '%)'"></div>
          <div class="split-seg" :style="{ width: unassignedPct + '%', background: '#d1d5db' }" :title="'Not Assigned: ' + unassigned + ' (' + unassignedPct + '%)'"></div>
        </div>
        <div class="split-legend">
          <span><span class="legend-dot" style="background:#2563eb;"></span>Assigned {{ assigned }} ({{ assignedPct }}%)</span>
          <span><span class="legend-dot" style="background:#d1d5db;"></span>Not Assigned {{ unassigned }} ({{ unassignedPct }}%)</span>
        </div>
      </div>

      <!-- Status distribution -->
      <div class="stats-section">
        <h3>Status Distribution</h3>
        <div class="status-rows">
          <div class="status-row" v-for="r in statusRows" :key="r.status">
            <span class="status-label">
              <span class="badge" :style="{ backgroundColor: STATUS_COLORS[r.status] || '#9ca3af' }">{{ r.status }}</span>
            </span>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: r.pct + '%', background: STATUS_COLORS[r.status] || '#9ca3af' }"></div>
            </div>
            <span class="status-count">{{ r.count }} <span class="status-pct">({{ r.pct }}%)</span></span>
          </div>
        </div>
      </div>

      <!-- Team status comparison: Dev vs QA -->
      <div class="stats-section">
        <h3>Team Status Comparison (Dev vs QA)</h3>
        <div class="team-cards">
          <div class="team-card" v-for="t in teamStats" :key="t.team">
            <div class="team-head">
              <span class="team-name"><span class="legend-dot" :style="{ background: t.color }"></span>{{ t.team }}</span>
              <span class="team-count">{{ t.count }} <span class="status-pct">({{ t.pct }}%)</span></span>
            </div>
            <div class="team-bar">
              <div class="bar-fill" :style="{ width: t.pct + '%', background: t.color }"></div>
            </div>
            <div class="team-members">
              <div class="member-row" v-for="m in t.members" :key="m.status">
                <span class="badge" :style="{ backgroundColor: m.color }">{{ m.status }}</span>
                <div class="mini-track member-track">
                  <div class="mini-fill" :style="{ width: m.pct + '%', background: m.color }"></div>
                </div>
                <span class="member-count">{{ m.count }}</span>
                <span class="member-sub">{{ m.assigned }} assigned / {{ m.unassigned }} unassigned</span>
              </div>
            </div>
          </div>
        </div>
        <div class="team-summary">Team total: {{ teamTotal }} of {{ total }} tasks (Dev + QA working statuses)</div>
      </div>

      <!-- Per-status assigned breakdown -->
      <div class="stats-section">
        <h3>Assigned per Status</h3>
        <table class="stats-table">
          <thead>
            <tr>
              <th>Status</th>
              <th class="center">Total</th>
              <th class="center">Assigned</th>
              <th class="center">Not Assigned</th>
              <th>Assigned %</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in perStatusAssignee" :key="r.status">
              <td><span class="badge" :style="{ backgroundColor: STATUS_COLORS[r.status] || '#9ca3af' }">{{ r.status }}</span></td>
              <td class="center">{{ r.count }}</td>
              <td class="center" style="color:#2563eb;font-weight:600;">{{ r.assigned }}</td>
              <td class="center" style="color:#9ca3af;">{{ r.unassigned }}</td>
              <td>
                <div class="mini-track">
                  <div class="mini-fill" :style="{ width: (r.count ? Math.round((r.assigned / r.count) * 100) : 0) + '%', background: '#2563eb' }"></div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stats-page {
  margin-top: 10px;
}
.stats-empty {
  padding: 30px;
  text-align: center;
  color: #9ca3af;
  font-size: 0.9rem;
  background: white;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}
.stats-cards {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  flex: 1;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 16px;
  text-align: center;
}
.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
}
.stat-label {
  font-size: 0.78rem;
  color: #6b7280;
  margin-top: 2px;
}
.stats-section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
}
.stats-section h3 {
  margin: 0 0 12px;
  font-size: 0.95rem;
  color: #374151;
}
.split-bar {
  display: flex;
  height: 22px;
  border-radius: 4px;
  overflow: hidden;
  background: #f3f4f6;
  margin-bottom: 8px;
}
.split-seg { transition: width 0.3s; }
.split-legend {
  display: flex;
  gap: 20px;
  font-size: 0.8rem;
  color: #4b5563;
}
.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 5px;
}
.status-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.status-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.status-label { width: 130px; flex-shrink: 0; }
.bar-track {
  flex: 1;
  height: 16px;
  background: #f3f4f6;
  border-radius: 3px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s;
}
.status-count {
  width: 90px;
  text-align: right;
  font-size: 0.82rem;
  font-weight: 600;
}
.status-pct { color: #9ca3af; font-weight: 400; }
.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.stats-table th {
  text-align: left;
  background: #f9fafb;
  padding: 8px 12px;
  border-bottom: 2px solid #e5e7eb;
  font-weight: 600;
  color: #4b5563;
}
.stats-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
}
.stats-table .center { text-align: center; }
.mini-track {
  height: 10px;
  background: #f3f4f6;
  border-radius: 3px;
  overflow: hidden;
}
.mini-fill { height: 100%; border-radius: 3px; }
.badge {
  font-size: 0.70rem;
  font-weight: 600;
  color: white;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

/* Team status comparison */
.team-cards {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.team-card {
  flex: 1;
  min-width: 260px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px 14px;
}
.team-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.team-name {
  font-weight: 700;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  gap: 6px;
}
.team-count { font-size: 0.85rem; font-weight: 600; }
.team-bar {
  height: 18px;
  background: #f3f4f6;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 10px;
}
.team-members { display: flex; flex-direction: column; gap: 7px; }
.member-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
}
.member-track { flex: 1; }
.member-count { width: 30px; text-align: right; font-weight: 600; }
.member-sub { color: #9ca3af; white-space: nowrap; }
.team-summary {
  margin-top: 10px;
  font-size: 0.8rem;
  color: #6b7280;
}
.stats-date {
  text-align: right;
  color: #6b7280;
  font-size: 0.8rem;
  margin-bottom: 8px;
}
.stats-filters {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 0.78rem;
  margin-bottom: 12px;
  word-break: break-word;
}
</style>
