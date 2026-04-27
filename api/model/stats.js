const { proxyToRender } = require("../../lib/vercelProxy")

module.exports = async (req, res) => {
  await proxyToRender(req, res, ["model", "stats"])
}
