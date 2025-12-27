import { pool } from "./db.js";

/**
 * PEDIDOS (B)
 * - POST   /pedidos                     cria pedido (ou retorna existente se mandar id)
 * - GET    /pedidos/:id                 carrega pedido + itens
 * - PATCH  /pedidos/:id                 atualiza dados do pedido (cliente/contato/obs/status)
 * - PUT    /pedidos/:id/itens           substitui itens do pedido (sync do carrinho)
 * - POST   /pedidos/:id/itens/add       adiciona/atualiza 1 item (atalhos do painel)
 * - POST   /pedidos/:id/itens/remove    remove 1 item por ref
 */

function cleanStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toInt(v, def = null) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

function toNum(v, def = 0) {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : def;
}

export async function pedidoRoutes(app) {
  // Criar pedido
  app.post("/pedidos", async (req, reply) => {
    const body = req.body || {};
    const catalogo_id = toInt(body.catalogo_id);
    if (!catalogo_id) return reply.code(400).send({ error: "catalogo_id é obrigatório" });

    // opcional: aceitar id (se quiser “garantir que existe”)
    const pedido_id = cleanStr(body.id);

    // valida catálogo
    const ck = await pool.query(`SELECT id FROM catalogos WHERE id=$1`, [catalogo_id]);
    if (!ck.rows.length) return reply.code(400).send({ error: "catalogo_id não existe" });

    if (pedido_id) {
      const ex = await pool.query(`SELECT * FROM pedidos WHERE id=$1`, [pedido_id]);
      if (ex.rows.length) return ex.rows[0];
    }

    const cliente_nome = cleanStr(body.cliente_nome);
    const cliente_contato = cleanStr(body.cliente_contato);
    const observacao = cleanStr(body.observacao);
    const status = cleanStr(body.status) || "aberto";

    const { rows } = await pool.query(
      `
      INSERT INTO pedidos (catalogo_id, cliente_nome, cliente_contato, observacao, status)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, catalogo_id, cliente_nome, cliente_contato, observacao, status, created_at
      `,
      [catalogo_id, cliente_nome, cliente_contato, observacao, status]
    );

    return rows[0];
  });

  // Ler pedido + itens
  app.get("/pedidos/:id", async (req, reply) => {
    const id = req.params.id;

    const pedido = await pool.query(
      `SELECT id, catalogo_id, cliente_nome, cliente_contato, observacao, status, created_at
       FROM pedidos WHERE id=$1`,
      [id]
    );
    if (!pedido.rows.length) return reply.code(404).send({ error: "Pedido não encontrado" });

    const itens = await pool.query(
      `SELECT ref, nome, pagina, qtd, qtd_multiplo, preco
       FROM pedido_itens
       WHERE pedido_id=$1
       ORDER BY nome ASC, ref ASC`,
      [id]
    );

    return { ...pedido.rows[0], itens: itens.rows };
  });

  // Atualizar metadados do pedido
  app.patch("/pedidos/:id", async (req, reply) => {
    const id = req.params.id;
    const body = req.body || {};

    const fields = [];
    const values = [];
    let i = 1;

    const add = (col, val) => {
      if (val === undefined) return;
      fields.push(`${col} = $${i++}`);
      values.push(val);
    };

    if (body.cliente_nome !== undefined) add("cliente_nome", cleanStr(body.cliente_nome));
    if (body.cliente_contato !== undefined) add("cliente_contato", cleanStr(body.cliente_contato));
    if (body.observacao !== undefined) add("observacao", cleanStr(body.observacao));
    if (body.status !== undefined) add("status", cleanStr(body.status) || "aberto");

    if (!fields.length) return reply.code(400).send({ error: "Nenhum campo para atualizar" });

    fields.push(`updated_at = now()`);

    values.push(id);

    const { rows } = await pool.query(
      `
      UPDATE pedidos
      SET ${fields.join(", ")}
      WHERE id = $${i}
      RETURNING id, catalogo_id, cliente_nome, cliente_contato, observacao, status, created_at
      `,
      values
    );

    if (!rows.length) return reply.code(404).send({ error: "Pedido não encontrado" });
    return rows[0];
  });

  // Sync total do carrinho: substitui itens do pedido
  app.put("/pedidos/:id/itens", async (req, reply) => {
    const id = req.params.id;
    const body = req.body || {};
    const itens = Array.isArray(body.itens) ? body.itens : null;

    if (!itens) return reply.code(400).send({ error: "itens (array) é obrigatório" });

    // pedido existe?
    const ck = await pool.query(`SELECT id FROM pedidos WHERE id=$1`, [id]);
    if (!ck.rows.length) return reply.code(404).send({ error: "Pedido não encontrado" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(`DELETE FROM pedido_itens WHERE pedido_id=$1`, [id]);

      for (const it of itens) {
        const ref = cleanStr(it.ref);
        const nome = cleanStr(it.nome) || "";
        const pagina = toInt(it.pagina, null);
        const qtd = Math.max(0, toInt(it.qtd, 0) || 0);
        const qtd_multiplo = Math.max(1, toInt(it.qtd_multiplo, 1) || 1);
        const preco = toNum(it.preco, 0);

        if (!ref || qtd <= 0) continue;

        await client.query(
          `
          INSERT INTO pedido_itens (pedido_id, ref, nome, pagina, qtd, qtd_multiplo, preco)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (pedido_id, ref)
          DO UPDATE SET
            nome = EXCLUDED.nome,
            pagina = EXCLUDED.pagina,
            qtd = EXCLUDED.qtd,
            qtd_multiplo = EXCLUDED.qtd_multiplo,
            preco = EXCLUDED.preco,
            updated_at = now()
          `,
          [id, ref, nome, pagina, qtd, qtd_multiplo, preco]
        );
      }

      await client.query(`UPDATE pedidos SET updated_at=now() WHERE id=$1`, [id]);

      await client.query("COMMIT");
      return { ok: true };
    } catch (e) {
      await client.query("ROLLBACK");
      req.log.error(e);
      return reply.code(500).send({ error: "Falha ao salvar itens", detail: String(e.message || e) });
    } finally {
      client.release();
    }
  });

  // Add/Update 1 item (incremental)
  app.post("/pedidos/:id/itens/add", async (req, reply) => {
    const id = req.params.id;
    const body = req.body || {};

    const ref = cleanStr(body.ref);
    const nome = cleanStr(body.nome) || "";
    const pagina = toInt(body.pagina, null);
    const delta = toInt(body.delta, 1) || 1;
    const qtd_multiplo = Math.max(1, toInt(body.qtd_multiplo, 1) || 1);
    const preco = toNum(body.preco, 0);

    if (!ref) return reply.code(400).send({ error: "ref é obrigatório" });

    const ck = await pool.query(`SELECT id FROM pedidos WHERE id=$1`, [id]);
    if (!ck.rows.length) return reply.code(404).send({ error: "Pedido não encontrado" });

    // upsert e soma quantidade
    const { rows } = await pool.query(
      `
      INSERT INTO pedido_itens (pedido_id, ref, nome, pagina, qtd, qtd_multiplo, preco)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (pedido_id, ref)
      DO UPDATE SET
        qtd = GREATEST(0, pedido_itens.qtd + EXCLUDED.qtd),
        nome = EXCLUDED.nome,
        pagina = EXCLUDED.pagina,
        qtd_multiplo = EXCLUDED.qtd_multiplo,
        preco = EXCLUDED.preco,
        updated_at = now()
      RETURNING ref, nome, pagina, qtd, qtd_multiplo, preco
      `,
      [id, ref, nome, pagina, delta, qtd_multiplo, preco]
    );

    await pool.query(`UPDATE pedidos SET updated_at=now() WHERE id=$1`, [id]);

    return rows[0];
  });

  // Remove por ref
  app.post("/pedidos/:id/itens/remove", async (req, reply) => {
    const id = req.params.id;
    const ref = cleanStr((req.body || {}).ref);
    if (!ref) return reply.code(400).send({ error: "ref é obrigatório" });

    await pool.query(`DELETE FROM pedido_itens WHERE pedido_id=$1 AND ref=$2`, [id, ref]);
    await pool.query(`UPDATE pedidos SET updated_at=now() WHERE id=$1`, [id]);
    return { ok: true };
  });
}
