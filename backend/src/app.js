import express from "express";
import cors from "cors";
import searchRoutes from "./routes/search.routes.js";
import facetRoutes from "./routes/facet.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", searchRoutes);
app.use("/api", facetRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const message = status === 500 ? "Internal server error" : err.message;
  res.status(status).json({ error: message });
});

export default app;
