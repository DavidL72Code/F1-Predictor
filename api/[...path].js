const { proxyToRender } = require("../lib/vercelProxy")

module.exports = async (req, res) => {
  const pathParts = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean)
  await proxyToRender(req, res, pathParts, ["path"])
}
