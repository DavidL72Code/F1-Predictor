const { proxyToRender } = require("../../../lib/vercelProxy")

module.exports = async (req, res) => {
  const { year, round } = req.query || {}
  await proxyToRender(req, res, ["races", String(year), String(round)], ["year", "round"])
}
