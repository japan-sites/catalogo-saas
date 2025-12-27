import { pool } from "./db.js";

/**
 * CSV esperado (header obrigatório):
 * pagina,nome,ref,qtd_multiplo,preco
 *
 * - pagina: número da página do PDF
 * - ref: código/REF único por catálogo
 * - qtd_multiplo: inteiro (default 1)
 * - preco: número (ex: 10.90)
 */

// parser simples de CSV (suporta aspas)
function parseCsv(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length);

  if (!lines.length) return [];

  const split = (line) => {
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        // "" vira "
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
        continue;
      }

      cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };

  const header = split(lines[0]).map((h) => h.toLowerCase());
  const idx = {
    pagina: header.indexOf("pagina"),
    nome: header.indexOf("nome"),
    ref: header.indexOf("ref"),
    qtd_multiplo: header.indexOf("qtd_multiplo"),
    preco: header.indexOf("preco"),
  };

  const missing = Object.entries(idx)
    .filter(([, v]) => v === -1)
    .map(([k]) => k);

  if (missing.length) {
    throw new Error(`CSV inválido: faltando colunas: ${missing.join(", ")}`);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = split(lines[i]);

    const pagina = Number(cols[idx.pagina]);
    const nome = String(cols[idx.nome] || "").trim();
    const ref = String(cols[idx.ref] || "").trim();
    const qtd_multiplo_raw = cols[idx.qtd_multiplo];
    const preco_raw = cols[idx.preco];

    const qtd_multiplo =
      qtd_multiplo_raw === "" || qtd_multiplo_raw == null ? 1 : Number(qtd_multiplo_raw);

    const preco =
      preco_raw === "" || preco_raw == null
        ? 0
        : Number(String(preco_raw).replace(",", "."));

    if (!Number.isFinite(pagina) || pagina <= 0) continue;
    if (!ref || !nome) continue;

    rows.push({
      pagina,
      nome,
      ref,
      qtd_multiplo: Number.isFinite(qtd_multiplo) && qtd_multiplo > 0 ? Math.floor(qtd_multiplo) : 1,
      preco: Number.isFinite(preco) ? preco : 0,
    });
  }

  return rows;
}

export async function catalogRoutes(app) {
  // ping simples
  app.get("/catalogos/ping", async () => ({ ok: true }));

  // LISTAR CATÁLOGOS
  app.get("/catalogos", async () => {
    const { rows } = await pool.query(`
      SELECT
        id, nome, ano, pdf_url,
        empresa_nome, whatsapp_phone, politica,
        created_at
      FROM catalogos
      ORDER BY id DESC
    `);
    return rows;
  });

  // OBTER 1 CATÁLOGO
  app.get("/catalogos/:id", async (req, reply) => {
    const id = Number(req.params.id);

    const { rows } = await pool.query(
      `
      SELECT
        id, nome, ano, pdf_url,
        empresa_nome,
        whatsapp_phone,
        politica,
        created_at
      FROM catalogos
      WHERE id = $1
      `,
      [id]
    );

    if (!rows.length) return reply.code(404).send({ error: "Catálogo não encontrado" });
    return rows[0];
  });

  // CRIAR CATÁLOGO
  app.post("/catalogos", async (req, reply) => {
    const body = req.body || {};

    const nome = String(body.nome || "").trim();
    const ano = body.ano === null || body.ano === undefined ? null : Number(body.ano);
    const pdf_url = String(body.pdf_url || "").trim();

    const empresa_nome =
      body.empresa_nome !== undefined && body.empresa_nome !== null
        ? String(body.empresa_nome).trim()
        : null;

    const whatsapp_phone =
      body.whatsapp_phone !== undefined && body.whatsapp_phone !== null
        ? String(body.whatsapp_phone).trim()
        : null;

    const politica =
      body.politica !== undefined && body.politica !== null
        ? String(body.politica).trim()
        : null;

    if (!nome) return reply.code(400).send({ error: "nome é obrigatório" });
    if (!pdf_url) return reply.code(400).send({ error: "pdf_url é obrigatório" });
    if (ano !== null && Number.isNaN(ano)) return reply.code(400).send({ error: "ano inválido" });

    const { rows } = await pool.query(
      `
      INSERT INTO catalogos (nome, ano, pdf_url, empresa_nome, whatsapp_phone, politica)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id, nome, ano, pdf_url,
        empresa_nome, whatsapp_phone, politica,
        created_at
      `,
      [nome, ano, pdf_url, empresa_nome, whatsapp_phone, politica]
    );

    return rows[0];
  });

  // PATCH CATÁLOGO
  app.patch("/catalogos/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const body = req.body || {};

    const fields = [];
    const values = [];
    let i = 1;

    function add(col, val) {
      if (val === undefined) return;
      fields.push(`${col} = $${i++}`);
      values.push(val);
    }

    if (body.nome !== undefined) add("nome", String(body.nome || "").trim());

    if (body.ano !== undefined) {
      const val = body.ano === null ? null : Number(body.ano);
      if (val !== null && Number.isNaN(val)) return reply.code(400).send({ error: "ano inválido" });
      add("ano", val);
    }

    if (body.pdf_url !== undefined) add("pdf_url", String(body.pdf_url || "").trim());

    if (body.empresa_nome !== undefined) {
      add("empresa_nome", body.empresa_nome === null ? null : String(body.empresa_nome).trim());
    }
    if (body.whatsapp_phone !== undefined) {
      add("whatsapp_phone", body.whatsapp_phone === null ? null : String(body.whatsapp_phone).trim());
    }
    if (body.politica !== undefined) {
      add("politica", body.politica === null ? null : String(body.politica).trim());
    }

    if (!fields.length) return reply.code(400).send({ error: "Nenhum campo para atualizar" });

    // updated_at sempre
    fields.push(`updated_at = now()`);

    values.push(id);

    const { rows } = await pool.query(
      `
      UPDATE catalogos
      SET ${fields.join(", ")}
      WHERE id = $${i}
      RETURNING
        id, nome, ano, pdf_url,
        empresa_nome, whatsapp_phone, politica,
        created_at
      `,
      values
    );

    if (!rows.length) return reply.code(404).send({ error: "Catálogo não encontrado" });
    return rows[0];
  });

  // IMPORTAR CSV -> UPSERT (A)
  app.post("/catalogos/:id/importar", async (req, reply) => {
    const catalogo_id = Number(req.params.id);
    const mode = String(req.query.mode || "replace").toLowerCase();

    // valida catálogo existe
    const ck = await pool.query(`SELECT id FROM catalogos WHERE id = $1`, [catalogo_id]);
    if (!ck.rows.length) return reply.code(404).send({ error: "Catálogo não encontrado" });

    const mp = await req.file();
    if (!mp) return reply.code(400).send({ error: "Envie um arquivo via multipart (field: file)" });

    const chunks = [];
    for await (const chunk of mp.file) chunks.push(chunk);
    const csvText = Buffer.concat(chunks).toString("utf8");

    let rows;
    try {
      rows = parseCsv(csvText);
    } catch (e) {
      return reply.code(400).send({ error: String(e.message || e) });
    }

    if (!rows.length) {
      return reply.code(400).send({ error: "CSV sem linhas válidas" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (mode === "replace") {
        await client.query(`DELETE FROM catalogo_produtos WHERE catalogo_id = $1`, [catalogo_id]);
      }

      // UPSERT por (catalogo_id, ref)
      // Observação: se mode=append, ele cria novos e atualiza os existentes.
      const upsertSql = `
        INSERT INTO catalogo_produtos (catalogo_id, pagina, ref, nome, qtd_multiplo, preco)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (catalogo_id, ref)
        DO UPDATE SET
          pagina = EXCLUDED.pagina,
          nome = EXCLUDED.nome,
          qtd_multiplo = EXCLUDED.qtd_multiplo,
          preco = EXCLUDED.preco,
          updated_at = now()
      `;

      for (const r of rows) {
        await client.query(upsertSql, [
          catalogo_id,
          r.pagina,
          r.ref,
          r.nome,
          r.qtd_multiplo,
          r.preco,
        ]);
      }

      await client.query("COMMIT");
      return { ok: true, catalogo_id, importados: rows.length, modo: mode };
    } catch (e) {
      await client.query("ROLLBACK");
      req.log.error(e);
      return reply.code(500).send({ error: "Falha ao importar", detail: String(e.message || e) });
    } finally {
      client.release();
    }
  });

  // PRODUTOS POR PÁGINA DO PDF (compatível com teu teste: ?page=8)
  app.get("/catalogos/:id/produtos", async (req, reply) => {
    const catalogo_id = Number(req.params.id);
    const page = Number(req.query.page || 1); // aqui "page" = página do PDF
    if (!Number.isFinite(page) || page <= 0) return reply.code(400).send({ error: "page inválido" });

    const { rows } = await pool.query(
      `
      SELECT pagina, nome, ref, qtd_multiplo, preco
      FROM catalogo_produtos
      WHERE catalogo_id = $1 AND pagina = $2
      ORDER BY nome ASC, ref ASC
      `,
      [catalogo_id, page]
    );

    return rows;
  });

  // BUSCA GLOBAL (painel do front)
  app.get("/catalogos/:id/busca", async (req, reply) => {
    const catalogo_id = Number(req.params.id);
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);

    if (!q) return [];

    // busca simples (ILIKE) + ordenação por página
    const { rows } = await pool.query(
      `
      SELECT pagina, nome, ref, qtd_multiplo, preco
      FROM catalogo_produtos
      WHERE catalogo_id = $1
        AND (ref ILIKE $2 OR nome ILIKE $2)
      ORDER BY pagina ASC, nome ASC
      LIMIT $3
      `,
      [catalogo_id, `%${q}%`, limit]
    );

    return rows;
  });
}
