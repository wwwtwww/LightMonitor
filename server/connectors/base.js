class BaseConnector {
  constructor(cfg) {
    this.cfg = cfg
  }
  async testConnection() {
    return { ok: false, online: false, error: 'not_supported' }
  }
  async collectMetrics() {
    throw new Error('not_supported')
  }
}

module.exports = BaseConnector
