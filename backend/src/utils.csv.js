import { parse } from "csv-parse";

function toInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toPrice(value, fallback = 0) {
  // aceita "10,90" ou "10.90" ou "1.234,56"
  const s = String(value ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

export async function parseCatalogCsv(readableStream) {
  return await new Promise((resolve, reject) => {
    const records = [];

    const parser = parse({
      delimiter: ";",
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true
    });

    readableStream
      .pipe(parser)
      .on("data", (row) => {
        const pagina = toInt(row.pagina, -1);
        const nome = String(row.nome ?? "").trim();
        const ref = String(row.ref ?? "").trim();
        const qtd_multiplo = Math.max(1, toInt(row.qtd_multiplo, 1));
        const preco = Math.max(0, toPrice(row.preco, 0));

        if (pagina <= 0) return;
        if (!nome || !ref) return;

        records.push({ pagina, nome, ref, qtd_multiplo, preco });
      })
      .on("error", reject)
      .on("end", () => resolve(records));
  });
}
