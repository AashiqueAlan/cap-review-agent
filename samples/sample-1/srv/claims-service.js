const cds = require("@sap/cds");

module.exports = (srv) => {
  srv.on("submit", async (req) => {
    for (const id of req.data.ids) {
      await cds.run(`SELECT * FROM claims WHERE ID='${id}'`);
    }
  });
};
