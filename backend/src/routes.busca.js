import { pool } from "./db.js";

export async function buscaRoutes(app) {
  // GET /catalogos/:id/busca?q=abc&limit=50
  app.get("/catalogos/:id/busca", async (req, reply) => {
    const catalogoId = Number(req.params.id);
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit || 50), 200);

    if (!catalogoId) return reply.code(400).send({ error: "catalogo_id inválido" });
    if (!q) return reply.send([]);

    // busca por ref ou nome (ILIKE)
    const { rows } = await pool.query(
      `
      select pagina, nome, ref, qtd_multiplo, preco
      from catalogo_produtos
      where catalogo_id = $1
        and (ref ilike $2 or nome ilike $2)
      order by
        case when ref ilike $2 then 0 else 1 end,
        pagina asc, ref asc
      limit $3
      `,
      [catalogoId, `%${q}%`, limit]
    );

    return rows;
  });
}
