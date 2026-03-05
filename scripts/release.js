const { spawnSync } = require('child_process')

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status || 1)
}

run('npm', ['run', 'build'])
run('npm', ['run', 'pack'])
