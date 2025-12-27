const BASE = import.meta.env.VITE_API_BASE || "http://localhost:3001";

async function http(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let msg = "";
    try {
      const j = await res.json();
      msg = j?.message || j?.error || JSON.stringify(j);
    } catch {
      msg = await res.text();
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

export const api = {
  ping: () => http("/catalogos/ping"),
  getCatalogs: () => http("/catalogos"),
  getCatalog: (id) => http(`/catalogos/${id}`),
  createCatalog: (payload) =>
    http("/catalogos", { method: "POST", body: JSON.stringify(payload) }),
  patchCatalog: (id, payload) =>
    http(`/catalogos/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  getCatalogProducts: (id, page) => http(`/catalogos/${id}/produtos?page=${page}`),
};
