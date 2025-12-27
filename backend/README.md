# Catalogo SaaS Backend

## Requisitos
- Node 20+
- Postgres (Supabase recomendado via Session Pooler)

## Setup
1) Instale deps:
```bash
npm install
Crie .env baseado em .env.example:

Use a URI do Supabase (Connect -> Method: Session pooler -> URI)

No Supabase rode:

sql/001_init.sql

sql/002_unique_upsert.sql

Teste DB:

bash
Copiar código
npm run test:db
Rode o servidor:

bash
Copiar código
npm run dev
Endpoints
GET /health

GET /catalogos

GET /catalogos/:id

POST /catalogos

PATCH /catalogos/:id

POST /catalogos/:id/importar?mode=replace|append (multipart file=csv)

GET /catalogos/:id/produtos?page=N

yaml
Copiar código

---

# Teste rápido (igual você fez)

### Criar catálogo
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/catalogos" -Method POST -ContentType "application/json" -Body '{"nome":"Teste Catalogo 2026","ano":2026,"pdf_url":"https://exemplo.com/catalogo.pdf"}'
Importar CSV
powershell
Copiar código
curl.exe -X POST "http://localhost:3001/catalogos/1/importar?mode=replace" -F "file=@catalogo_produtos.csv"
Buscar página
powershell
Copiar código
Invoke-RestMethod "http://localhost:3001/catalogos/1/produtos?page=8"