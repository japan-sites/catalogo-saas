import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { catalogRoutes } from "./routes.catalogos.js";
import { pedidoRoutes } from "./routes.pedidos.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || true,
});

await app.register(multipart, {
  limits: { fileSize: 30 * 1024 * 1024 },
});

app.get("/health", async () => ({ ok: true }));

await app.register(catalogRoutes);
await app.register(pedidoRoutes);

const port = Number(process.env.PORT || 3001);
await app.listen({ port, host: "0.0.0.0" });
