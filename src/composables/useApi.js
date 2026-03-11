import axios from 'axios'
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const API_URL = '/api'

export function useApi() {
  const tableData = ref([])
  const activeTarget = ref({})

  const fetchList = async () => {
    try {
      const rows = (await axios.get(`${API_URL}/databases`)).data.data
      tableData.value = (rows || []).map(r => ({
        ...r,
        system_name: r?.system_name ?? r?.business_system ?? ''
      }))
    } catch (e) {
      console.error(e)
    }
  }

  const testConnection = async (form) => {
    try {
      const res = await axios.post(`${API_URL}/databases/${form.id}/test`)
      const r = res.data
      if (r.ok) ElMessage.success(`Connected ${r.latencyMs}ms`)
      else ElMessage.error(r.error || 'Connection failed')
    } catch (e) {
      ElMessage.error('Connection failed')
    }
  }

  const saveTarget = async (form, callback) => {
    const payload = { ...form }
    if (!payload.password) delete payload.password
    try {
      if (payload.id) {
        await axios.put(`${API_URL}/databases/${payload.id}`, payload)
      } else {
        await axios.post(`${API_URL}/databases`, payload)
      }
      ElMessage.success('Saved')
      await fetchList()
      if (callback) callback()
    } catch (e) {
      ElMessage.error('Save failed')
    }
  }

  const deleteTarget = async (id) => {
    try {
      await ElMessageBox.confirm('Delete this target?', 'Confirm', { type: 'warning' })
      await axios.delete(`${API_URL}/databases/${id}`)
      ElMessage.success('Deleted')
      await fetchList()
    } catch {}
  }

  const getLocks = async (id) => {
    try {
      const res = await axios.get(`${API_URL}/databases/${id}/mysql/locks`)
      return (res.data.waits || []).map(w => ({
        blocking_thread: w.blockedBy,
        waiting_thread: w.threadId,
        lock_duration: w.waitingSec,
        blocking_query: '-',
        waiting_query: '-'
      }))
    } catch {
      return []
    }
  }

  const killSession = async (dbId, threadId) => {
    try {
      await ElMessageBox.confirm(`Kill thread ${threadId}?`, 'Warning', { type: 'error' })
      const res = await axios.post(`${API_URL}/databases/${dbId}/mysql/kill`, { threadId })
      if (res.data.ok) {
        ElMessage.success('KILL sent')
        return true
      } else {
        ElMessage.error(res.data.error || 'Operation failed')
        return false
      }
    } catch {
      return false
    }
  }

  const getTopSlow = async (id) => {
    try {
      const res = await axios.get(`${API_URL}/databases/${id}/mysql/top-slow`)
      return (res.data.data || []).map(x => ({
        sql_text: x.sql,
        exec_count: x.count,
        max_time: x.avgLatencyMs
      }))
    } catch {
      return []
    }
  }

  const getMssqlBlocking = async (id) => {
    try {
      const res = await axios.get(`${API_URL}/databases/${id}/mssql/blocking`)
      return res.data.data || []
    } catch {
      return []
    }
  }

  const getMetrics = async (id, params = {}) => {
    try {
        const query = new URLSearchParams()
        if (params.range) query.set('range', params.range)
        if (params.date) query.set('date', params.date)
        if (params.from !== undefined && params.from !== null) query.set('from', String(params.from))
        if (params.to !== undefined && params.to !== null) query.set('to', String(params.to))
        if (params.maxPoints !== undefined && params.maxPoints !== null) query.set('maxPoints', String(params.maxPoints))
        if (params.stepMs !== undefined && params.stepMs !== null) query.set('stepMs', String(params.stepMs))
        const url = `${API_URL}/databases/${id}/metrics${query.toString() ? `?${query.toString()}` : ''}`
        const res = await axios.get(url)
        return res.data.data || []
    } catch {
        return []
    }
  }

  const getMaintenanceStats = async (includeCounts = false) => {
    try {
      const url = includeCounts ? `${API_URL}/maintenance/stats?includeCounts=1` : `${API_URL}/maintenance/stats`
      const res = await axios.get(url)
      return res.data.data || {}
    } catch {
      return {}
    }
  }

  const getMaintenanceConfig = async () => {
    try {
      const res = await axios.get(`${API_URL}/maintenance/config`)
      return res.data.data || { retention_days: 7, cleanup_time: '03:00' }
    } catch {
      return { retention_days: 7, cleanup_time: '03:00' }
    }
  }

  const saveMaintenanceConfig = async (cfg) => {
    try {
      const res = await axios.post(`${API_URL}/maintenance/config`, cfg)
      return res.data.data || cfg
    } catch {
      throw new Error('save_failed')
    }
  }

  const runMaintenanceCleanup = async (days, options = {}) => {
    try {
      const payload = { days }
      if (options.vacuum === true) payload.vacuum = true
      if (options.batchSize !== undefined && options.batchSize !== null) payload.batchSize = options.batchSize
      const res = await axios.post(`${API_URL}/maintenance/cleanup`, payload)
      return res.data.data || {}
    } catch {
      throw new Error('cleanup_failed')
    }
  }

  return {
    tableData,
    activeTarget,
    fetchList,
    testConnection,
    saveTarget,
    deleteTarget,
    getLocks,
    killSession,
    getTopSlow,
    getMssqlBlocking,
    getMetrics,
    getMaintenanceStats,
    getMaintenanceConfig,
    saveMaintenanceConfig,
    runMaintenanceCleanup
  }
}
