import http from 'node:http'

const host = process.env.OLLAMA_BRIDGE_HOST || '172.17.0.1'
const port = Number(process.env.OLLAMA_BRIDGE_PORT || '11434')

const server = http.createServer((request, response) => {
  const upstream = http.request({ host: '127.0.0.1', port: 11434, method: request.method, path: request.url, headers: request.headers }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: 'Host Ollama is unavailable.' }))
  })
  request.pipe(upstream)
})

server.listen(port, host, () => console.log(`Ollama bridge listening on ${host}:${port}`))
