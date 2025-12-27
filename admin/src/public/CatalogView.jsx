// C:\Users\Japan_01\catalogo-saas\admin\src\public\CatalogView.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

// ✅ Worker do pdf.js (Vite-friendly)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/**
 * CatalogView (B2B)
 * - Layout: 75% PDF (scroll vertical) + 25% painel modal (direita)
 * - Padrão: Fit Largura + scroll vertical
 * - Fit toggle: Largura ↔ Altura (botão + tecla F)
 * - Lupa: zoom com Ctrl+Roda (ou botão +/-) + arrastar (Space ou botão do meio)
 * - Atalhos:
 *   ←/→ página
 *   Enter adiciona selecionado (na busca)
 *   +/- quantidade (item selecionado no carrinho)
 *   F toggle fit
 *   Esc carrinho
 * - Busca global instantânea (debounce leve)
 * - Toast discreto ao adicionar
 * - Carrinho persistente (localStorage)
 * - Múltiplo inteligente (qtd sempre no múltiplo)
 * - Copiar pedido (texto)
 * - Cache páginas renderizadas + pré-render próxima
 * - ResizeObserver refit automático
 * - Fallback de erro CORS/URL do PDF
 * - Link do pedido (pedido_id)
 */

// =========================
// Helpers
// =========================
const BACKEND_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BACKEND_URL) ||
  "http://localhost:3001";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function num(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function moneyBR(v) {
  const n = num(v);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function safeJsonParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function getCatalogIdFromPath() {
  // /c/3  OR /c/3?x
  const p = window.location.pathname || "";
  const parts = p.split("/").filter(Boolean);
  const idx = parts.indexOf("c");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

function getPedidoIdFromPath() {
  // /p/<uuid>
  const p = window.location.pathname || "";
  const parts = p.split("/").filter(Boolean);
  const idx = parts.indexOf("p");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

function debounce(fn, wait = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function makePedidoText({ catalogo, itens, total }) {
  const linhas = [];
  linhas.push(`🧾 Pedido B2B — ${catalogo?.nome || "Catálogo"}`);
  if (catalogo?.empresa_nome) linhas.push(`🏷️ Empresa: ${catalogo.empresa_nome}`);
  if (catalogo?.politica) linhas.push(`📌 Política: ${catalogo.politica}`);
  linhas.push("");
  linhas.push("Itens:");
  for (const it of itens) {
    linhas.push(
      `• ${it.nome} | Ref: ${it.ref} | Qtd: ${it.qtd} | ${moneyBR(it.preco)} | Sub: ${moneyBR(
        it.preco * it.qtd
      )}`
    );
  }
  linhas.push("");
  linhas.push(`Total: ${moneyBR(total)}`);
  return linhas.join("\n");
}

function makeWhatsAppLink(phoneE164, text) {
  const phone = String(phoneE164 || "").replace(/[^\d]/g, "");
  const base = phone ? `https://wa.me/${phone}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

// =========================
// Component
// =========================
export default function CatalogView() {
  // Route params
  const catalogoId = getCatalogIdFromPath();
  const pedidoIdFromLink = getPedidoIdFromPath();

  // Catalog
  const [catalogo, setCatalogo] = useState(null);
  const [loadingCatalogo, setLoadingCatalogo] = useState(true);

  // PDF
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfError, setPdfError] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);

  // View modes
  const [fitMode, setFitMode] = useState("width"); // 'width' | 'height'
  const [zoom, setZoom] = useState(1); // zoom manual adicional
  const [isFitLocked, setIsFitLocked] = useState(true); // quando true, zoom não manda no fit base (fit base calcula e multiplica)
  const [rendering, setRendering] = useState(false);

  // PDF viewport / pan
  const pdfWrapRef = useRef(null); // scroll container (vertical)
  const pdfStageRef = useRef(null); // area visível
  const canvasRef = useRef(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const spaceDownRef = useRef(false);

  // Cache pages renderizadas
  // key: `${page}|${scale}`
  const pageCacheRef = useRef(new Map());

  // Prefetch/render next
  const preRenderRef = useRef({ page: null, scale: null });

  // Produtos / painel
  const [produtosPagina, setProdutosPagina] = useState([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);

  // Busca global
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchMode, setSearchMode] = useState(false);
  const [selectedSearchIdx, setSelectedSearchIdx] = useState(0);

  // Painel modal (direita)
  const [panelOpen, setPanelOpen] = useState(true);
  const panelDelayRef = useRef(null);

  // Carrinho modal (direita)
  const [cartOpen, setCartOpen] = useState(false);

  // Carrinho (persistente)
  const cartKey = useMemo(() => `catalogo_cart_${catalogoId || "unknown"}`, [catalogoId]);
  const pedidoKey = useMemo(() => `catalogo_pedido_${catalogoId || "unknown"}`, [catalogoId]);

  const [pedidoId, setPedidoId] = useState(null);
  const [cart, setCart] = useState(() => []);
  const [toast, setToast] = useState(null);

  // UI selection (para atalhos +/- no carrinho)
  const [selectedCartRef, setSelectedCartRef] = useState(null);

  // =========================
  // Load from localStorage
  // =========================
  useEffect(() => {
    // cart
    const saved = safeJsonParse(localStorage.getItem(cartKey) || "null", null);
    if (saved && Array.isArray(saved.cart)) setCart(saved.cart);

    // pedido id
    const savedPedido = safeJsonParse(localStorage.getItem(pedidoKey) || "null", null);
    if (savedPedido?.pedidoId) setPedidoId(savedPedido.pedidoId);
  }, [cartKey, pedidoKey]);

  useEffect(() => {
    localStorage.setItem(cartKey, JSON.stringify({ cart }));
  }, [cart, cartKey]);

  useEffect(() => {
    if (pedidoId) localStorage.setItem(pedidoKey, JSON.stringify({ pedidoId }));
  }, [pedidoId, pedidoKey]);

  // =========================
  // Toast
  // =========================
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // =========================
  // Fetch catalog
  // =========================
  useEffect(() => {
    let alive = true;
    async function run() {
      try {
        setLoadingCatalogo(true);
        setPdfError("");

        if (!catalogoId) {
          setPdfError("Catálogo inválido na URL. Ex: /c/3");
          return;
        }

        const res = await fetch(`${BACKEND_URL}/catalogos/${catalogoId}`);
        if (!res.ok) throw new Error(`Erro ao buscar catálogo: ${res.status}`);
        const data = await res.json();

        if (!alive) return;

        setCatalogo(data);
        setPdfUrl(String(data?.pdf_url || ""));
      } catch (e) {
        if (!alive) return;
        setPdfError(e?.message || "Falha ao carregar catálogo");
      } finally {
        if (alive) setLoadingCatalogo(false);
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [catalogoId]);

  // =========================
  // Load pedido by link (/p/:id)
  // =========================
  useEffect(() => {
    let alive = true;
    async function run() {
      if (!pedidoIdFromLink) return;
      try {
        const res = await fetch(`${BACKEND_URL}/pedidos/${pedidoIdFromLink}`);
        if (!res.ok) throw new Error("Pedido não encontrado.");
        const data = await res.json();

        if (!alive) return;

        // Esperado: { id, catalogo_id, itens: [...] }
        setPedidoId(data.id);
        if (Array.isArray(data.itens)) {
          setCart(
            data.itens.map((it) => ({
              ref: it.ref,
              nome: it.nome,
              pagina: Number(it.pagina) || 1,
              preco: num(it.preco),
              qtd_multiplo: Number(it.qtd_multiplo) || 1,
              qtd: Number(it.qtd) || 1,
            }))
          );
        }
        setCartOpen(true);
      } catch (e) {
        // sem drama
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, [pedidoIdFromLink]);

  // =========================
  // PDF load
  // =========================
  useEffect(() => {
    let alive = true;

    async function run() {
      if (!pdfUrl) return;
      try {
        setPdfError("");
        setPdfDoc(null);
        setNumPages(0);

        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          withCredentials: false,
        });

        const doc = await loadingTask.promise;
        if (!alive) return;

        setPdfDoc(doc);
        setNumPages(doc.numPages || 0);
        setPage(1);

        // limpa cache quando muda pdf
        pageCacheRef.current.clear();
        setPan({ x: 0, y: 0 });
        panRef.current = { x: 0, y: 0 };
      } catch (e) {
        if (!alive) return;
        setPdfError(
          "Falha ao carregar PDF. Verifique se a URL é pública (CORS) e acessível no navegador."
        );
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [pdfUrl]);

  // =========================
  // Fetch produtos da página
  // =========================
  useEffect(() => {
    let alive = true;

    async function run() {
      if (!catalogoId) return;
      if (!page) return;
      try {
        setLoadingProdutos(true);

        const res = await fetch(`${BACKEND_URL}/catalogos/${catalogoId}/produtos?page=${page}`);
        if (!res.ok) throw new Error("Falha ao buscar produtos");
        const data = await res.json();

        if (!alive) return;

        // pode vir array puro ou {items:[]}
        const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
        setProdutosPagina(
          items.map((p) => ({
            pagina: Number(p.pagina) || page,
            nome: String(p.nome || p.descricao || "").trim() || "Produto",
            ref: String(p.ref || p.codigo || "").trim() || `REF-${Math.random().toString(16).slice(2)}`,
            qtd_multiplo: Number(p.qtd_multiplo || p.multiplo || 1) || 1,
            preco: num(p.preco),
          }))
        );
      } catch {
        if (!alive) return;
        setProdutosPagina([]);
      } finally {
        if (alive) setLoadingProdutos(false);
      }
    }

    // só busca página quando NÃO estiver no searchMode
    if (!searchMode) run();

    return () => {
      alive = false;
    };
  }, [catalogoId, page, searchMode]);

  // =========================
  // Busca global instantânea (debounce)
  // =========================
  const runSearch = useMemo(
    () =>
      debounce(async (q) => {
        const term = String(q || "").trim();
        if (!term) {
          setSearchMode(false);
          setSearchResults([]);
          setSelectedSearchIdx(0);
          return;
        }

        setSearchMode(true);
        setSelectedSearchIdx(0);

        // ✅ endpoint padrão (ajuste aqui se seu backend usar outro)
        const url = `${BACKEND_URL}/catalogos/${catalogoId}/produtos?search=${encodeURIComponent(
          term
        )}`;

        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("search fail");
          const data = await res.json();
          const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];

          setSearchResults(
            items.slice(0, 50).map((p) => ({
              pagina: Number(p.pagina) || 1,
              nome: String(p.nome || p.descricao || "").trim() || "Produto",
              ref: String(p.ref || p.codigo || "").trim() || "REF",
              qtd_multiplo: Number(p.qtd_multiplo || p.multiplo || 1) || 1,
              preco: num(p.preco),
            }))
          );
        } catch {
          setSearchResults([]);
        }
      }, 220),
    [catalogoId]
  );

  useEffect(() => {
    runSearch(search);
  }, [search, runSearch]);

  // =========================
  // Pedido (backend)
  // =========================
  async function ensurePedidoId() {
    if (pedidoId) return pedidoId;

    const res = await fetch(`${BACKEND_URL}/pedidos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogo_id: Number(catalogoId),
        cliente_nome: null,
        cliente_contato: "WhatsApp",
        observacao: "B2B",
      }),
    });

    if (!res.ok) throw new Error("Falha ao criar pedido");
    const data = await res.json();
    setPedidoId(data.id);
    return data.id;
  }

  async function syncPedidoToBackend(nextCart) {
    const id = await ensurePedidoId();
    const body = {
      itens: (nextCart || []).map((it) => ({
        ref: it.ref,
        nome: it.nome,
        pagina: it.pagina,
        qtd: it.qtd,
        qtd_multiplo: it.qtd_multiplo,
        preco: num(it.preco),
      })),
    };

    const res = await fetch(`${BACKEND_URL}/pedidos/${id}/itens`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error("Falha ao salvar itens");
    return true;
  }

  // =========================
  // Cart logic
  // =========================
  function roundToMultiplo(qtd, multiplo) {
    const m = Math.max(1, Number(multiplo) || 1);
    const q = Math.max(0, Number(qtd) || 0);
    return Math.max(m, Math.round(q / m) * m);
  }

  function addToCart(p, forcedQty = null) {
    setCart((prev) => {
      const m = Math.max(1, Number(p.qtd_multiplo) || 1);
      const idx = prev.findIndex((i) => i.ref === p.ref);
      const addQty = forcedQty !== null ? Number(forcedQty) : m;

      let next;
      if (idx >= 0) {
        next = [...prev];
        const cur = next[idx];
        const newQtd = roundToMultiplo((cur.qtd || 0) + addQty, m);
        next[idx] = { ...cur, qtd: newQtd, qtd_multiplo: m, preco: num(p.preco) };
      } else {
        next = [
          ...prev,
          {
            ref: p.ref,
            nome: p.nome,
            pagina: Number(p.pagina) || page,
            preco: num(p.preco),
            qtd_multiplo: m,
            qtd: roundToMultiplo(addQty, m),
          },
        ];
      }

      setSelectedCartRef(p.ref);
      setToast(`Adicionado: ${p.ref} • +${addQty}`);
      // sync best-effort (não trava UI)
      syncPedidoToBackend(next).catch(() => {});
      return next;
    });
  }

  function removeFromCart(ref) {
    setCart((prev) => {
      const next = prev.filter((i) => i.ref !== ref);
      syncPedidoToBackend(next).catch(() => {});
      if (selectedCartRef === ref) setSelectedCartRef(next[0]?.ref || null);
      return next;
    });
  }

  function setCartQty(ref, qtd) {
    setCart((prev) => {
      const next = prev.map((i) => {
        if (i.ref !== ref) return i;
        const m = Math.max(1, Number(i.qtd_multiplo) || 1);
        const q = roundToMultiplo(qtd, m);
        return { ...i, qtd: q };
      });
      syncPedidoToBackend(next).catch(() => {});
      return next;
    });
  }

  function clearCart() {
    setCart(() => {
      syncPedidoToBackend([]).catch(() => {});
      return [];
    });
    setSelectedCartRef(null);
  }

  const total = useMemo(() => cart.reduce((acc, it) => acc + num(it.preco) * (Number(it.qtd) || 0), 0), [cart]);

  // =========================
  // WhatsApp
  // =========================
  async function onEnviarWhatsApp() {
    try {
      if (!cart.length) return;

      const id = await ensurePedidoId();
      // garante que o backend está com itens atualizados
      await syncPedidoToBackend(cart);

      const link = `${window.location.origin}/p/${id}`;
      const text =
        makePedidoText({ catalogo, itens: cart, total }) +
        `\n\n🔗 Link do pedido: ${link}`;

      const wa = makeWhatsAppLink(catalogo?.whatsapp_phone, text);
      window.open(wa, "_blank", "noopener,noreferrer");
    } catch {
      // se falhar backend, manda só texto local mesmo
      const id = pedidoId || "(sem-id)";
      const link = `${window.location.origin}/p/${id}`;
      const text =
        makePedidoText({ catalogo, itens: cart, total }) +
        `\n\n🔗 Link do pedido: ${link}`;

      const wa = makeWhatsAppLink(catalogo?.whatsapp_phone, text);
      window.open(wa, "_blank", "noopener,noreferrer");
    }
  }

  async function onCopiarPedido() {
    const id = pedidoId || "(sem-id)";
    const link = `${window.location.origin}/p/${id}`;
    const text =
      makePedidoText({ catalogo, itens: cart, total }) +
      `\n\n🔗 Link do pedido: ${link}`;

    try {
      await navigator.clipboard.writeText(text);
      setToast("Pedido copiado ✅");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setToast("Pedido copiado ✅");
    }
  }

  // =========================
  // Page navigation
  // =========================
  function goPage(next) {
    const n = clamp(Number(next) || 1, 1, Math.max(1, numPages || 1));
    setPage(n);
  }
  function nextPage() {
    goPage(page + 1);
  }
  function prevPage() {
    goPage(page - 1);
  }

  // =========================
  // Fit / scale calc + render
  // =========================
  const fitBaseScaleRef = useRef(1);

  function toggleFit() {
    setFitMode((m) => (m === "width" ? "height" : "width"));
    setIsFitLocked(true);
    setToast("Fit alternado");
  }

  function computeFitScale(viewportW, viewportH, pageW, pageH) {
    if (!viewportW || !viewportH || !pageW || !pageH) return 1;
    if (fitMode === "width") return viewportW / pageW;
    return viewportH / pageH;
  }

  async function renderPage(targetPage, reason = "nav") {
    if (!pdfDoc || !canvasRef.current || !pdfStageRef.current) return;

    const canvas = canvasRef.current;
    const stage = pdfStageRef.current;

    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;

    setRendering(true);

    try {
      const pg = await pdfDoc.getPage(targetPage);

      // viewport base (scale 1)
      const vp1 = pg.getViewport({ scale: 1 });
      const fitScale = computeFitScale(stageW, stageH, vp1.width, vp1.height);

      fitBaseScaleRef.current = fitScale;

      const effectiveScale = fitScale * (isFitLocked ? zoom : zoom);
      // (zoom sempre multiplica; isFitLocked só muda como UX se comporta)

      const cacheKey = `${targetPage}|${effectiveScale.toFixed(4)}`;
      const cached = pageCacheRef.current.get(cacheKey);

      // se tiver cache, só desenha imagem no canvas (sem rerender pesado)
      if (cached) {
        const ctx = canvas.getContext("2d");
        canvas.width = cached.width;
        canvas.height = cached.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(cached.img, 0, 0);
        // reset pan ao trocar página
        setPan({ x: 0, y: 0 });
        panRef.current = { x: 0, y: 0 };
        return;
      }

      const viewport = pg.getViewport({ scale: effectiveScale });

      // render real
      const ctx = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const task = pg.render({
        canvasContext: ctx,
        viewport,
        intent: "display",
      });

      await task.promise;

      // salva em cache (imagem)
      const img = new Image();
      img.src = canvas.toDataURL("image/png");
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });

      pageCacheRef.current.set(cacheKey, {
        img,
        width: canvas.width,
        height: canvas.height,
      });

      // reset pan ao render
      setPan({ x: 0, y: 0 });
      panRef.current = { x: 0, y: 0 };

      // pré-render next (leve)
      preRenderNext(targetPage + 1, fitScale, effectiveScale);
    } catch (e) {
      setPdfError("Falha ao renderizar página (PDF pesado ou URL bloqueada).");
    } finally {
      setRendering(false);
    }
  }

  async function preRenderNext(nextPg, fitScale, effectiveScale) {
    if (!pdfDoc) return;
    if (nextPg < 1 || nextPg > (numPages || 1)) return;

    // não refaz se já está pronto
    const key = `${nextPg}|${effectiveScale.toFixed(4)}`;
    if (pageCacheRef.current.has(key)) return;

    // evita loop
    if (preRenderRef.current.page === nextPg && preRenderRef.current.scale === effectiveScale) return;
    preRenderRef.current = { page: nextPg, scale: effectiveScale };

    try {
      const pg = await pdfDoc.getPage(nextPg);
      const vp = pg.getViewport({ scale: effectiveScale });

      const off = document.createElement("canvas");
      off.width = Math.floor(vp.width);
      off.height = Math.floor(vp.height);
      const ctx = off.getContext("2d", { alpha: false });

      const task = pg.render({ canvasContext: ctx, viewport: vp, intent: "display" });
      await task.promise;

      const img = new Image();
      img.src = off.toDataURL("image/png");
      await new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      });

      pageCacheRef.current.set(key, {
        img,
        width: off.width,
        height: off.height,
      });
    } catch {
      // ignora
    }
  }

  // Render on changes (page, zoom, fitMode, pdfDoc ready)
  useEffect(() => {
    if (!pdfDoc) return;
    renderPage(page, "page/zoom/fit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, page, zoom, fitMode]);

  // ResizeObserver -> refit
  useEffect(() => {
    if (!pdfStageRef.current) return;
    const el = pdfStageRef.current;

    const ro = new ResizeObserver(() => {
      // refit automático sem piscar: só chama render quando fit está ativo
      renderPage(page, "resize");
    });

    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, page, fitMode, zoom]);

  // =========================
  // Mouse / wheel: lupa + pan
  // =========================
  function onWheel(e) {
    // Lupa: Ctrl + roda (ou trackpad)
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY;
      const factor = delta > 0 ? 0.92 : 1.08;
      setZoom((z) => clamp(z * factor, 0.25, 4.0));
      return;
    }
    // sem ctrl: deixa o scroll vertical do container funcionar normal
  }

  function startPan(clientX, clientY) {
    isPanningRef.current = true;
    panStartRef.current = {
      x: clientX,
      y: clientY,
      px: panRef.current.x,
      py: panRef.current.y,
    };
  }

  function movePan(clientX, clientY) {
    if (!isPanningRef.current) return;
    const dx = clientX - panStartRef.current.x;
    const dy = clientY - panStartRef.current.y;
    const next = { x: panStartRef.current.px + dx, y: panStartRef.current.py + dy };
    panRef.current = next;
    setPan(next);
  }

  function stopPan() {
    isPanningRef.current = false;
  }

  function onMouseDown(e) {
    // Space + arrastar (ou botão do meio)
    const isMiddle = e.button === 1;
    if (spaceDownRef.current || isMiddle) {
      e.preventDefault();
      startPan(e.clientX, e.clientY);
    }
  }

  function onMouseMove(e) {
    movePan(e.clientX, e.clientY);
  }

  function onMouseUp() {
    stopPan();
  }

  function onMouseLeave() {
    stopPan();
  }

  // =========================
  // Keyboard shortcuts
  // =========================
  useEffect(() => {
    function onKeyDown(e) {
      // não atrapalhar input
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
      const isTyping = tag === "input" || tag === "textarea";

      if (e.code === "Space") {
        // space para pan
        if (!isTyping) {
          spaceDownRef.current = true;
          // evita scroll do space
          e.preventDefault();
        }
      }

      // Esc = carrinho
      if (e.key === "Escape") {
        setCartOpen(false);
        return;
      }

      // F = fit
      if (!isTyping && (e.key === "f" || e.key === "F")) {
        toggleFit();
        return;
      }

      // Navegação página
      if (!isTyping && e.key === "ArrowLeft") {
        prevPage();
        return;
      }
      if (!isTyping && e.key === "ArrowRight") {
        nextPage();
        return;
      }

      // Enter adiciona selecionado (busca)
      if (e.key === "Enter" && searchMode && searchResults.length) {
        const p = searchResults[selectedSearchIdx] || searchResults[0];
        if (p) {
          addToCart(p);
          // pular pra página do produto (opcional, mas útil)
          if (p.pagina) setPage(Number(p.pagina) || page);
        }
        return;
      }

      // +/- quantidade no carrinho (item selecionado)
      if (!isTyping && (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_")) {
        if (!selectedCartRef) return;
        const it = cart.find((x) => x.ref === selectedCartRef);
        if (!it) return;
        const m = Math.max(1, Number(it.qtd_multiplo) || 1);
        if (e.key === "-" || e.key === "_") setCartQty(it.ref, (it.qtd || m) - m);
        else setCartQty(it.ref, (it.qtd || 0) + m);
        return;
      }
    }

    function onKeyUp(e) {
      if (e.code === "Space") {
        spaceDownRef.current = false;
      }
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [searchMode, searchResults, selectedSearchIdx, cart, selectedCartRef]);

  // =========================
  // Panel hover delay (sem tremedeira)
  // =========================
  function openPanelDelayed() {
    clearTimeout(panelDelayRef.current);
    panelDelayRef.current = setTimeout(() => setPanelOpen(true), 450);
  }
  function closePanelDelayed() {
    clearTimeout(panelDelayRef.current);
    panelDelayRef.current = setTimeout(() => setPanelOpen(false), 650);
  }

  // =========================
  // UI data
  // =========================
  const produtosParaMostrar = searchMode ? searchResults : produtosPagina;

  // =========================
  // Styles (inline, pra não depender de CSS externo)
  // =========================
  const styles = {
    page: {
      minHeight: "100vh",
      background: "radial-gradient(1200px 600px at 40% 20%, rgba(80,120,255,0.10), transparent 60%), #070A12",
      color: "#E9EDF7",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    },
    topbar: {
      height: 72,
      padding: "14px 18px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      position: "sticky",
      top: 0,
      zIndex: 30,
      backdropFilter: "blur(10px)",
      background: "rgba(7,10,18,0.72)",
    },
    brand: { display: "flex", gap: 12, alignItems: "center" },
    badge: {
      width: 36,
      height: 36,
      borderRadius: 12,
      background: "rgba(90,120,255,0.25)",
      display: "grid",
      placeItems: "center",
      border: "1px solid rgba(90,120,255,0.35)",
      fontWeight: 800,
    },
    h1: { margin: 0, fontSize: 18, fontWeight: 800, lineHeight: 1.1 },
    sub: { margin: 0, fontSize: 12, opacity: 0.7 },
    btnRow: { display: "flex", gap: 10, alignItems: "center" },
    btn: {
      padding: "10px 14px",
      borderRadius: 14,
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.10)",
      color: "#E9EDF7",
      cursor: "pointer",
      fontWeight: 700,
    },
    btnGreen: {
      padding: "10px 14px",
      borderRadius: 14,
      background: "rgba(16,185,129,0.22)",
      border: "1px solid rgba(16,185,129,0.35)",
      color: "#E9EDF7",
      cursor: "pointer",
      fontWeight: 800,
    },
    main: {
  display: "grid",
  gridTemplateColumns: "1fr 360px",
  gap: 18,
  padding: 18,
  alignItems: "stretch",
  height: "calc(100vh - 72px)", // ocupa tudo abaixo da topbar
  overflow: "hidden",
},

    pdfCard: {
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  overflow: "hidden",
  position: "relative",
  display: "flex",
  flexDirection: "column",
  minHeight: 0, // importantíssimo pra flex + overflow funcionar
},


    controls: {
      padding: 12,
      display: "flex",
      gap: 10,
      alignItems: "center",
      justifyContent: "center",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
    },
    pill: {
      padding: "10px 14px",
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.05)",
      display: "flex",
      gap: 10,
      alignItems: "center",
      fontWeight: 800,
    },
    pdfWrap: {
  flex: 1,
  minHeight: 0, // importantíssimo
  overflowY: "auto",
  overflowX: "hidden",
  position: "relative",
},

    pdfStage: {
  width: "100%",
  minHeight: 0,
  display: "flex",
  justifyContent: "center",
  padding: 18,
},

    canvasShell: {
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(0,0,0,0.25)",
      boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
      overflow: "hidden",
      position: "relative",
    },
    canvas: {
      display: "block",
      transform: `translate(${pan.x}px, ${pan.y}px)`,
      willChange: "transform",
    },
   side: {
  position: "sticky",
  top: 90,
  height: "calc(100vh - 110px)",
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  minHeight: 0, // importantíssimo
},

    sideHeader: {
      padding: 14,
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    },
    sideTitle: { fontWeight: 900 },
    input: {
      width: "100%",
      padding: "12px 14px",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(0,0,0,0.25)",
      color: "#E9EDF7",
      outline: "none",
    },
    sideBody: {
  padding: 14,
  flex: 1,
  minHeight: 0, // importantíssimo
  overflow: "auto",
},

    card: {
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.04)",
      padding: 12,
      marginBottom: 12,
    },
    cardRow: { display: "flex", justifyContent: "space-between", gap: 12 },
    tiny: { fontSize: 12, opacity: 0.75 },
    hr: { height: 1, background: "rgba(255,255,255,0.08)", margin: "10px 0" },
    footer: {
  padding: 14,
  borderTop: "1px solid rgba(255,255,255,0.08)",
  display: "grid",
  gap: 10,
  flexShrink: 0, // garante que o rodapé nunca “some”
},

    toast: {
      position: "fixed",
      left: "50%",
      bottom: 18,
      transform: "translateX(-50%)",
      padding: "10px 14px",
      borderRadius: 14,
      background: "rgba(0,0,0,0.68)",
      border: "1px solid rgba(255,255,255,0.12)",
      zIndex: 80,
      fontWeight: 800,
      boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
    },
    modalBackdrop: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.45)",
      backdropFilter: "blur(4px)",
      zIndex: 70,
    },
    cartModal: {
      position: "fixed",
      top: 0,
      right: 0,
      height: "100vh",
      width: 420,
      maxWidth: "92vw",
      background: "rgba(7,10,18,0.92)",
      borderLeft: "1px solid rgba(255,255,255,0.10)",
      zIndex: 75,
      display: "flex",
      flexDirection: "column",
    },
    cartHead: {
      padding: 14,
      borderBottom: "1px solid rgba(255,255,255,0.10)",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    },
    cartBody: { padding: 14, overflow: "auto", flex: 1 },
    cartFoot: {
      padding: 14,
      borderTop: "1px solid rgba(255,255,255,0.10)",
      display: "grid",
      gap: 10,
    },
    qtyBox: {
      display: "grid",
      gridTemplateColumns: "40px 1fr 40px",
      gap: 8,
      alignItems: "center",
      marginTop: 10,
    },
    qtyBtn: {
      height: 36,
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.06)",
      color: "#E9EDF7",
      cursor: "pointer",
      fontWeight: 900,
    },
    qtyInput: {
      height: 36,
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(0,0,0,0.25)",
      color: "#E9EDF7",
      textAlign: "center",
      fontWeight: 900,
      outline: "none",
    },
  };

  // =========================
  // Render
  // =========================
  const badgeLetter = useMemo(() => {
    const n = catalogo?.nome || "Catálogo";
    return String(n[0] || "C").toUpperCase();
  }, [catalogo]);

  // ajuda a evitar “piscar”: não re-renderizar canvas por hover (aqui não tem)
  const hintAtalhos =
    "Atalhos: ←/→ página • Enter adiciona (busca) • +/- qtd (carrinho) • F fit • Esc carrinho • Ctrl+roda zoom • Space arrasta";

  return (
    <div style={styles.page}>
      {/* TOPBAR */}
      <div style={styles.topbar}>
        <div style={styles.brand}>
          <div style={styles.badge}>{badgeLetter}</div>
          <div>
            <p style={styles.sub}>Catálogo público</p>
            <p style={styles.h1}>
              {loadingCatalogo ? "Carregando..." : `${catalogo?.nome || "Catálogo"} • ${catalogo?.ano || ""}`}
            </p>
          </div>
        </div>

        <div style={styles.btnRow}>
          <button style={styles.btn} onClick={() => (window.location.href = "/")}>
            Admin
          </button>

          <button style={styles.btn} onClick={() => setPanelOpen((v) => !v)}>
            Painel
          </button>

          <button style={styles.btnGreen} onClick={() => setCartOpen(true)}>
            Carrinho
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div style={styles.main}>
        {/* PDF AREA */}
        <div style={styles.pdfCard}>
          <div style={styles.controls}>
            <button style={styles.pill} onClick={prevPage} disabled={page <= 1 || rendering}>
              ◀ Anterior
            </button>

            <div style={styles.pill}>
              Página {page} / {numPages || "—"}
            </div>

            <button
              style={styles.pill}
              onClick={nextPage}
              disabled={numPages ? page >= numPages : false || rendering}
            >
              Próxima ▶
            </button>

            <div style={{ width: 14 }} />

            <button style={styles.pill} onClick={() => setZoom((z) => clamp(z * 0.9, 0.25, 4.0))}>
              −
            </button>

            <div style={styles.pill}>{Math.round(zoom * 100)}%</div>

            <button style={styles.pill} onClick={() => setZoom((z) => clamp(z * 1.1, 0.25, 4.0))}>
              +
            </button>

            <button style={styles.pill} onClick={toggleFit}>
              Fit ({fitMode === "width" ? "Largura" : "Altura"})
            </button>
          </div>

          <div style={{ padding: "0 14px 12px", opacity: 0.75, fontSize: 12 }}>{hintAtalhos}</div>

          <div
            ref={pdfWrapRef}
            style={styles.pdfWrap}
            onWheel={onWheel}
          >
            <div
              ref={pdfStageRef}
              style={styles.pdfStage}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
            >
              <div style={styles.canvasShell}>
                {!pdfDoc && !pdfError && (
                  <div style={{ padding: 20, opacity: 0.8 }}>
                    Carregando PDF...
                  </div>
                )}

                {pdfError && (
                  <div style={{ padding: 20, color: "#FCA5A5", maxWidth: 800 }}>
                    <b>Falha ao carregar PDF.</b>
                    <div style={{ marginTop: 8, opacity: 0.9 }}>{pdfError}</div>
                    <div style={{ marginTop: 12, opacity: 0.7 }}>
                      Dica: use uma URL HTTP acessível (ex.: <code>http://localhost:5173/pdfs/arquivo.pdf</code>),
                      não <code>file:///</code>.
                    </div>
                  </div>
                )}

                <canvas ref={canvasRef} style={styles.canvas} />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL (25%) */}
        <div
          style={{
            ...styles.side,
            transform: panelOpen ? "translateX(0)" : "translateX(320px)",
            transition: "transform 280ms ease",
            opacity: panelOpen ? 1 : 0.0,
            pointerEvents: panelOpen ? "auto" : "none",
          }}
          onMouseEnter={openPanelDelayed}
          onMouseLeave={closePanelDelayed}
        >
          <div style={styles.sideHeader}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Produtos • {searchMode ? "busca global" : `p.${page}`}
              </div>
              <div style={styles.sideTitle}>{catalogo?.nome || "Catálogo"}</div>
            </div>
            <button style={styles.btn} onClick={() => setPanelOpen(false)}>
              Fechar
            </button>
          </div>

          <div style={{ padding: 14 }}>
            <input
              style={styles.input}
              placeholder="Buscar no catálogo (ref/nome)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
              Dica: digite e use Enter para adicionar o selecionado.
            </div>
          </div>

          <div style={styles.sideBody}>
            {loadingProdutos && !searchMode && <div style={{ opacity: 0.75 }}>Carregando produtos...</div>}

            {!produtosParaMostrar.length && (
              <div style={styles.card}>
                <div style={{ opacity: 0.8 }}>
                  {searchMode ? `Sem resultados para “${search}”.` : "Nenhum produto nesta página."}
                </div>
              </div>
            )}

            {produtosParaMostrar.map((p, idx) => {
              const selected = searchMode && idx === selectedSearchIdx;
              return (
                <div
                  key={`${p.ref}-${idx}`}
                  style={{
                    ...styles.card,
                    outline: selected ? "2px solid rgba(90,120,255,0.65)" : "none",
                  }}
                  onMouseEnter={() => {
                    if (searchMode) setSelectedSearchIdx(idx);
                  }}
                >
                  <div style={styles.cardRow}>
                    <div style={{ fontWeight: 900, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.nome}
                    </div>
                    <div style={{ fontWeight: 900 }}>{moneyBR(p.preco)}</div>
                  </div>

                  <div style={{ ...styles.tiny, marginTop: 6 }}>
                    Ref: {p.ref} • pág. {p.pagina} • Múltiplo: {p.qtd_multiplo}
                  </div>

                  <div style={styles.hr} />

                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button
                      style={{ ...styles.btnGreen, flex: 1 }}
                      onClick={() => {
                        addToCart(p);
                        if (p.pagina) setPage(Number(p.pagina) || page);
                      }}
                    >
                      Adicionar
                    </button>

                    <button
                      style={styles.btn}
                      onClick={() => {
                        // adicionar 1 múltiplo rápido
                        addToCart(p, Math.max(1, Number(p.qtd_multiplo) || 1));
                      }}
                      title="Adicionar 1 múltiplo"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={styles.footer}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900 }}>
              <span>Total</span>
              <span>{moneyBR(total)}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button style={styles.btn} onClick={clearCart}>
                Limpar
              </button>
              <button style={styles.btnGreen} onClick={() => setCartOpen(true)}>
                Abrir carrinho
              </button>
            </div>

            <div style={{ fontSize: 12, opacity: 0.65 }}>
              Pedido ID: <span style={{ opacity: 0.95 }}>{pedidoId || "—"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* CART MODAL */}
      {cartOpen && (
        <>
          <div style={styles.modalBackdrop} onClick={() => setCartOpen(false)} />
          <div style={styles.cartModal}>
            <div style={styles.cartHead}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>Carrinho • WhatsApp</div>
                <div style={{ fontWeight: 900 }}>{catalogo?.nome || "Catálogo"}</div>
                {pedidoId && (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Link: {window.location.origin}/p/{pedidoId}
                  </div>
                )}
              </div>
              <button style={styles.btn} onClick={() => setCartOpen(false)}>
                Fechar (Esc)
              </button>
            </div>

            <div style={styles.cartBody}>
              {!cart.length && (
                <div style={styles.card}>
                  Carrinho vazio. Clique em <b>Adicionar</b> nos produtos.
                </div>
              )}

              {cart.map((it) => {
                const selected = selectedCartRef === it.ref;
                return (
                  <div
                    key={it.ref}
                    style={{
                      ...styles.card,
                      outline: selected ? "2px solid rgba(16,185,129,0.55)" : "none",
                    }}
                    onClick={() => setSelectedCartRef(it.ref)}
                  >
                    <div style={styles.cardRow}>
                      <div style={{ fontWeight: 900, maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {it.nome}
                      </div>
                      <div style={{ fontWeight: 900 }}>{moneyBR(it.preco)}</div>
                    </div>

                    <div style={{ ...styles.tiny, marginTop: 6 }}>
                      Ref: {it.ref} • múltiplo {it.qtd_multiplo} • pág. {it.pagina}
                    </div>

                    <div style={styles.qtyBox}>
                      <button
                        style={styles.qtyBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCartQty(it.ref, (it.qtd || it.qtd_multiplo) - it.qtd_multiplo);
                        }}
                      >
                        −
                      </button>

                      <input
                        style={styles.qtyInput}
                        value={it.qtd}
                        onChange={(e) => setCartQty(it.ref, Number(e.target.value) || it.qtd_multiplo)}
                      />

                      <button
                        style={styles.qtyBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCartQty(it.ref, (it.qtd || 0) + it.qtd_multiplo);
                        }}
                      >
                        +
                      </button>
                    </div>

                    <div style={{ ...styles.tiny, marginTop: 8, display: "flex", justifyContent: "space-between" }}>
                      <span>Múltiplo inteligente: ajusta para {it.qtd_multiplo}.</span>
                      <span>Sub: {moneyBR(num(it.preco) * (Number(it.qtd) || 0))}</span>
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                      <button
                        style={styles.btn}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromCart(it.ref);
                        }}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={styles.cartFoot}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900 }}>
                <span>Total</span>
                <span>{moneyBR(total)}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <button style={styles.btn} onClick={onCopiarPedido} disabled={!cart.length}>
                  Copiar pedido
                </button>

                <button style={styles.btnGreen} onClick={onEnviarWhatsApp} disabled={!cart.length}>
                  Enviar WhatsApp
                </button>
              </div>

              <button style={styles.btn} onClick={clearCart} disabled={!cart.length}>
                Limpar carrinho
              </button>
            </div>
          </div>
        </>
      )}

      {/* TOAST */}
      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}
