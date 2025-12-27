import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import CatalogView from "./public/CatalogView";
import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Rota intermediária:
 * /p/:pedidoId
 * carrega pedido → redireciona para /c/:catalogoId?p=pedidoId
 */
function PedidoRedirect() {
  const { pedidoId } = useParams();
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API}/pedidos/${pedidoId}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(pedido => {
        window.location.replace(`/c/${pedido.catalogo_id}?p=${pedidoId}`);
      })
      .catch(() => {
        setError("Pedido não encontrado");
      });
  }, [pedidoId]);

  if (error) return <div style={{ padding: 40 }}>{error}</div>;
  return <div style={{ padding: 40 }}>Carregando pedido...</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/c/1" />} />
        <Route path="/c/:catalogoId" element={<CatalogView />} />
        <Route path="/p/:pedidoId" element={<PedidoRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}
