import { onMounted, onUnmounted } from 'vue'
import { useApi } from './useApi'

export function useTargetsStore({ pollMs = 3000 } = {}) {
  const api = useApi()
  let timer = null

  const start = async () => {
    await api.fetchList()
    timer = setInterval(api.fetchList, pollMs)
  }

  const stop = () => {
    clearInterval(timer)
    timer = null
  }

  onMounted(start)
  onUnmounted(stop)

  return {
    ...api,
    start,
    stop
  }
}

