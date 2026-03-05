const mysql = require('mysql2/promise')

const config = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DB || 'information_schema'
}

// Config
const CONCURRENCY = 20
const DURATION_SEC = 30
const SLOW_RATE = 0.05

async function worker(id) {
  let conn;
  try {
    conn = await mysql.createConnection(config);
    console.log(`Worker ${id} connected.`);
    
    const end = Date.now() + DURATION_SEC * 1000;
    let count = 0;
    
    while (Date.now() < end) {
      try {
        if (Math.random() < SLOW_RATE) {
          // Simulate slow query (1-3s)
          const sleepTime = Math.floor(Math.random() * 2) + 1;
          await conn.query(`SELECT SLEEP(${sleepTime})`);
          // console.log(`Worker ${id} executed slow query (${sleepTime}s)`);
        } else {
          // Fast query
          await conn.query('SELECT 1');
        }
        count++;
      } catch (e) {
        console.error(`Worker ${id} error:`, e.message);
        await new Promise(r => setTimeout(r, 1000)); // Backoff
      }
    }
    console.log(`Worker ${id} finished. Queries: ${count}`);
  } catch (e) {
    console.error(`Worker ${id} connection failed:`, e.message);
  } finally {
    if (conn) await conn.end();
  }
}

async function main() {
  console.log(`Starting stress test on ${config.host}:${config.port}...`);
  console.log(`Concurrency: ${CONCURRENCY}, Duration: ${DURATION_SEC}s`);
  
  const promises = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    promises.push(worker(i));
  }
  
  await Promise.all(promises);
  console.log('Stress test completed.');
}

main().catch(console.error);
