const http = require('http');
const server = http.createServer((req, res) => res.end('ok'));
const port = 9090;
try {
  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
  server.on('error', (e) => {
    console.error('Server error:', e);
  });
} catch (e) {
  console.error('Catch error:', e);
}
