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

function isAllowedPath(pathParts) {
  if (!Array.isArray(pathParts) || pathParts.length === 0) return false
  if (pathParts.length === 1) {
    return ["health", "races", "years", "circuits", "analytics"].includes(pathParts[0])
  }
  if (pathParts.length === 2) {
    if (pathParts[0] === "model" && pathParts[1] === "stats") return true
    // The Analytics page reads the walk-forward benchmark from here. Without
    // this the page 404s in production while working fine locally, because
    // only the Vercel deployment goes through this allowlist.
    return pathParts[0] === "analytics" && pathParts[1] === "walk-forward"
  }
  if (pathParts.length === 3) {
    return pathParts[0] === "races"
      && /^\d{4}$/.test(pathParts[1])
      && /^\d+$/.test(pathParts[2])
  }
  return false
}

async function proxyToRender(req, res, pathParts, ignoredKeys = []) {
  const base = (process.env.RENDER_API_URL || process.env.REACT_APP_API_URL || "").replace(/\/$/, "")

  if (!base) {
    res.status(500).json({
      error: "RENDER_API_URL is not configured on Vercel",
    })
    return
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) {
    res.setHeader("allow", "GET, HEAD, OPTIONS")
    res.status(405).json({
      error: "Method not allowed",
    })
    return
  }

  if (!isAllowedPath(pathParts)) {
    res.status(404).json({
      error: "Unknown API route",
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
    // Log the cause server-side; do not return it. fetch failures embed the
    // upstream URL, which would expose the internal backend host to callers.
    console.error("Upstream request failed:", error)
    res.status(502).json({
      error: "Unable to reach the Render backend",
    })
  }
}

module.exports = {
  isAllowedPath,
  proxyToRender,
}
