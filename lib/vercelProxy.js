function buildSearchParams(query, ignoredKeys = []) {
  const ignored = new Set(ignoredKeys)
  const search = new URLSearchParams()

  Object.entries(query || {}).forEach(([key, value]) => {
    if (ignored.has(key)) return
    if (Array.isArray(value)) {
      value.forEach((item) => search.append(key, item))
    } else if (value !== undefined) {
      search.append(key, value)
    }
  })

  return search
}

async function proxyToRender(req, res, pathParts, ignoredKeys = []) {
  const base = (process.env.RENDER_API_URL || process.env.REACT_APP_API_URL || "").replace(/\/$/, "")

  if (!base) {
    res.status(500).json({
      error: "RENDER_API_URL is not configured on Vercel",
    })
    return
  }

  const search = buildSearchParams(req.query, ignoredKeys)
  const url = `${base}/${pathParts.join("/")}${search.toString() ? `?${search.toString()}` : ""}`

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        "content-type": req.headers["content-type"] || "application/json",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    })

    const contentType = upstream.headers.get("content-type")
    if (contentType) res.setHeader("content-type", contentType)

    res.status(upstream.status).send(await upstream.text())
  } catch (error) {
    res.status(502).json({
      error: "Unable to reach the Render backend",
      detail: error.message,
    })
  }
}

module.exports = {
  proxyToRender,
}
