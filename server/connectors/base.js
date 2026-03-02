class BaseConnector {
  constructor(cfg) {
    this.cfg = cfg
  }
  async testConnection() {
    return { ok: true, online: true, latencyMs: Math.floor(Math.random() * 50) + 10 }
  }
  async collectMetrics() {
    const sessions = Math.floor(Math.random() * 50)
    const qps = Math.floor(Math.random() * 200)
    const tps = Math.floor(Math.random() * 80)
    const slowCount = Math.random() < 0.2 ? Math.floor(Math.random() * 5) : 0
    return { sessions, qps, tps, slowCount }
  }
}

module.exports = BaseConnector

