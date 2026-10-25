const pool = require("../../db");
const { createApp } = require("../../server");

const app = createApp({ databasePool: pool, env: process.env });

const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (process.send) {
    process.send({
      type: "listening",
      port: address.port,
      pid: process.pid,
    });
  }
});

function shutdown() {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
