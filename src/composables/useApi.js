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
      if (r.ok) ElMessage.success(`连接成功 ${r.latencyMs}ms`)
      else ElMessage.error(r.error || '连接失败')
    } catch (e) {
      ElMessage.error('连接失败')
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
      ElMessage.success('保存成功')
      await fetchList()
      if (callback) callback()
    } catch (e) {
      ElMessage.error('保存失败')
    }
  }

  const deleteTarget = async (id) => {
    try {
      await ElMessageBox.confirm('确认删除?', '提示', { type: 'warning' })
      await axios.delete(`${API_URL}/databases/${id}`)
      ElMessage.success('已删除')
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
      await ElMessageBox.confirm(`确定强杀线程 ${threadId}?`, '警告', { type: 'error' })
      const res = await axios.post(`${API_URL}/databases/${dbId}/mysql/kill`, { threadId })
      if (res.data.ok) {
        ElMessage.success('已发送 KILL')
        return true
      } else {
        ElMessage.error(res.data.error || '操作失败')
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

  const getMetrics = async (id, params = {}) => {
    try {
        const query = new URLSearchParams()
        if (params.range) query.set('range', params.range)
        if (params.date) query.set('date', params.date)
        if (params.from) query.set('from', String(params.from))
        if (params.to) query.set('to', String(params.to))
        const url = `${API_URL}/databases/${id}/metrics${query.toString() ? `?${query.toString()}` : ''}`
        const res = await axios.get(url)
        return res.data.data || []
    } catch {
        return []
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
    getMetrics
  }
}
