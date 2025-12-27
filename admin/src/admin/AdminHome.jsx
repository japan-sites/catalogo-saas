import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "")
    .replace(/-+/g, "-");
}

export default function AdminHome() {
  const [catalogs, setCatalogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  // create
  const [nome, setNome] = useState("");
  const [ano, setAno] = useState(new Date().getFullYear());
  const [pdfUrl, setPdfUrl] = useState("");

  // edit (selected)
  const [editPdfUrl, setEditPdfUrl] = useState("");
  const [editEmpresa, setEditEmpresa] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editPolitica, setEditPolitica] = useState("");

  const selectedId = selected?.id;

  const slug = useMemo(() => slugify(nome), [nome]);

  async function refresh() {
    setLoading(true);
    try {
      const rows = await api.getCatalogs();
      setCatalogs(Array.isArray(rows) ? rows : []);
      // mantém selected coerente
      if (selectedId) {
        const found = (rows || []).find((c) => c.id === selectedId);
        if (found) setSelected(found);
      }
    } catch (e) {
      console.error(e);
      alert(`Falha ao carregar catálogos: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(c) {
    setSelected(c);
    setEditPdfUrl(c?.pdf_url || "");
    setEditEmpresa(c?.empresa_nome || "");
    setEditWhatsapp(c?.whatsapp_phone || "");
    setEditPolitica(c?.politica || "");
  }

  async function createCatalog(e) {
    e.preventDefault();
    if (!nome.trim()) return alert("Informe o nome do catálogo");
    if (!pdfUrl.trim()) return alert("Informe a URL do PDF (pode ser temporário)");

    setLoading(true);
    try {
      const c = await api.createCatalog({
        nome: nome.trim(),
        ano: Number(ano) || null,
        pdf_url: pdfUrl.trim(),
      });
      await refresh();
      pick(c);
      setNome("");
      setPdfUrl("");
    } catch (err) {
      console.error(err);
      alert(`Falha ao criar: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveSelected() {
    if (!selectedId) return;

    setLoading(true);
    try {
      const updated = await api.patchCatalog(selectedId, {
        pdf_url: editPdfUrl.trim(),
        empresa_nome: editEmpresa.trim(),
        whatsapp_phone: editWhatsapp.trim(),
        politica: editPolitica.trim(),
      });

      // atualiza lista local sem drama
      setCatalogs((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, ...updated } : c))
      );
      setSelected((prev) => ({ ...prev, ...updated }));

      alert("Salvo ✅");
    } catch (err) {
      console.error(err);
      alert(`Falha ao salvar: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function publicUrlForCatalog(c) {
    return `/c/${c.id}`;
  }

  function phoneHint(v) {
    const s = String(v || "").trim();
    if (!s) return "Ex: 5511999999999 (sem + e sem espaços)";
    if (!/^\d+$/.test(s)) return "Só números. Ex: 5511999999999";
    if (!s.startsWith("55")) return "Sugestão BR: comece com 55 + DDD + número";
    return "OK";
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Admin • Catálogos</h1>
            <p className="text-slate-400 mt-1">
              Sem terminal. Sem drama. Só operação.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="rounded-xl bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
              disabled={loading}
            >
              {loading ? "Carregando..." : "Atualizar"}
            </button>

            <a
              href="/template_catalogo_produtos.csv"
              className="text-sm text-indigo-300 hover:text-indigo-200"
            >
              Baixar template CSV
            </a>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Lista */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-semibold">Catálogos</h2>
              <span className="text-xs text-slate-500">
                {catalogs.length} itens
              </span>
            </div>

            <div className="divide-y divide-slate-800">
              {catalogs.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pick(c)}
                  className={[
                    "w-full text-left p-4 hover:bg-slate-900/60 transition",
                    selectedId === c.id ? "bg-slate-900/70" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{c.nome}</div>
                    <div className="text-xs text-slate-400">#{c.id}</div>
                  </div>
                  <div className="text-sm text-slate-400 mt-1 truncate">
                    {c.ano ? `${c.ano} • ` : ""}{c.pdf_url || ""}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    Público: <span className="font-mono">{publicUrlForCatalog(c)}</span>
                  </div>
                </button>
              ))}

              {catalogs.length === 0 && (
                <div className="p-4 text-sm text-slate-400">
                  Nenhum catálogo ainda.
                </div>
              )}
            </div>
          </div>

          {/* Operação */}
          <div className="space-y-6">
            {/* Criar */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h2 className="font-semibold">Operação</h2>
                <span className="text-xs text-slate-500">Novo catálogo</span>
              </div>

              <form onSubmit={createCatalog} className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-slate-300">Nome</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Toymix 2026"
                    />
                    <div className="mt-1 text-xs text-slate-500">
                      slug: <span className="font-mono">{slug || "catalogo"}</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-slate-300">Ano</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                      value={ano}
                      onChange={(e) => setAno(e.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm text-slate-300">PDF URL</label>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                    value={pdfUrl}
                    onChange={(e) => setPdfUrl(e.target.value)}
                    placeholder="https://.../catalogo.pdf"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-40"
                  disabled={loading}
                >
                  Criar catálogo
                </button>
              </form>
            </div>

            {/* Editar selecionado */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
              <div className="p-4 border-b border-slate-800">
                <h2 className="font-semibold">Configuração do catálogo (B2B)</h2>
                <div className="text-xs text-slate-500 mt-1">
                  Isso alimenta o botão “Enviar no WhatsApp” do catálogo público.
                </div>
              </div>

              {!selected && (
                <div className="p-4 text-sm text-slate-400">
                  Selecione um catálogo na lista para editar.
                </div>
              )}

              {selected && (
                <div className="p-4 space-y-3">
                  <div className="text-sm text-slate-300">
                    Selecionado: <b>#{selected.id}</b> • {selected.nome}
                  </div>

                  <div>
                    <label className="text-sm text-slate-300">PDF URL</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                      value={editPdfUrl}
                      onChange={(e) => setEditPdfUrl(e.target.value)}
                      placeholder="https://.../catalogo.pdf"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm text-slate-300">Nome da empresa</label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                        value={editEmpresa}
                        onChange={(e) => setEditEmpresa(e.target.value)}
                        placeholder="Japan Brinquedos"
                      />
                      <div className="text-xs text-slate-500 mt-1">
                        Vai no final do pedido como assinatura.
                      </div>
                    </div>

                    <div>
                      <label className="text-sm text-slate-300">WhatsApp (E.164 só números)</label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                        value={editWhatsapp}
                        onChange={(e) => setEditWhatsapp(e.target.value)}
                        placeholder="5511999999999"
                      />
                      <div className="text-xs mt-1 text-slate-500">
                        {phoneHint(editWhatsapp)}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-slate-300">Política / Observação</label>
                    <textarea
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm min-h-[90px]"
                      value={editPolitica}
                      onChange={(e) => setEditPolitica(e.target.value)}
                      placeholder="Pedido sujeito à confirmação de estoque e prazo."
                    />
                    <div className="text-xs text-slate-500 mt-1">
                      Entra no final da mensagem do WhatsApp.
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveSelected}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40"
                      disabled={loading}
                    >
                      Salvar
                    </button>

                    <a
                      href={publicUrlForCatalog(selected)}
                      className="rounded-xl bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
                    >
                      Abrir público
                    </a>
                  </div>
                </div>
              )}
            </div>

            <div className="text-xs text-slate-500">
              Dica: para abrir já em modo vendedor no público use{" "}
              <span className="font-mono">/c/{selected?.id || 1}?seller=1</span>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
