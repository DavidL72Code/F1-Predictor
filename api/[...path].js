const { proxyToRender } = require("../lib/vercelProxy")

module.exports = async (req, res) => {
  const queryPathParts = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean)
  const requestPath = (req.url || "").split("?")[0].replace(/^\/api\/?/, "")
  const fallbackPathParts = requestPath ? requestPath.split("/").filter(Boolean) : []
  const pathParts = queryPathParts.length > 0 ? queryPathParts : fallbackPathParts
  await proxyToRender(req, res, pathParts, ["path"])
}
