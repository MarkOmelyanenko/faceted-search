import "./loadEnv.js";
import app from "./app.js";

const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the other listener, or set PORT (e.g. PORT=3001 in .env).\n` +
        `  macOS: lsof -iTCP:${port} -sTCP:LISTEN`,
    );
    process.exit(1);
  }
  throw err;
});
