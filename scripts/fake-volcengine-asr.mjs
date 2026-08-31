import http from "node:http"

const port = Number(process.env.FAKE_ASR_PORT ?? 18081)
const apiKey = process.env.FAKE_ASR_API_KEY ?? "remote-e2e-only"
const resourceId = process.env.FAKE_ASR_RESOURCE_ID ?? "volc.bigasr.auc_turbo"
const transcript = process.env.FAKE_ASR_TRANSCRIPT ?? "无人机一号返航"

function reject(response, message) {
  response.writeHead(400, {
    "Content-Type": "application/json",
    "X-Api-Status-Code": "45000001",
  })
  response.end(JSON.stringify({ message }))
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(204).end()
    return
  }
  if (request.method !== "POST" || request.url !== "/api/v3/auc/bigmodel/recognize/flash") {
    response.writeHead(404).end()
    return
  }
  let chunks = []
  let size = 0
  request.on("data", (chunk) => {
    size += chunk.length
    if (size > 2_000_000) request.destroy()
    else chunks.push(chunk)
  })
  const clear = () => {
    chunks = []
  }
  request.on("aborted", clear)
  request.on("close", clear)
  request.on("end", () => {
    if (
      request.headers["x-api-key"] !== apiKey ||
      request.headers["x-api-resource-id"] !== resourceId
    ) {
      reject(response, "invalid contract credentials")
      return
    }
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      const wav = Buffer.from(payload.audio.data, "base64")
      if (
        payload.user?.uid !== apiKey ||
        payload.request?.model_name !== "bigmodel" ||
        "language" in payload.request ||
        wav.subarray(0, 4).toString("ascii") !== "RIFF"
      ) {
        reject(response, "ASR body does not match the Flash contract")
        return
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        "X-Api-Status-Code": "20000000",
      })
      response.end(JSON.stringify({ result: { text: transcript } }))
    } catch {
      reject(response, "malformed ASR request")
    }
  })
})

server.requestTimeout = 5_000
server.headersTimeout = 5_000
server.listen(port, "127.0.0.1")

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    const force = setTimeout(() => {
      server.closeAllConnections()
      process.exit(0)
    }, 1_000)
    force.unref()
    server.close(() => process.exit(0))
  })
}
