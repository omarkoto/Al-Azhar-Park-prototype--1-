# Al-Azhar Park — staff portal

React + Vite + Tailwind app for editing the park's content (park information, contact details, opening hours and special hours) and managing roles and permissions. It talks only to the backend API; see [../docs/park-cms.md](../docs/park-cms.md) and [../docs/authentication.md](../docs/authentication.md).

```bash
cd portal
npm install
cp .env.example .env          # VITE_API_URL (default http://localhost:3000/api/v1)
npm run dev                   # http://localhost:5174  (the backend's CORS_ORIGINS already allows it)
npm test                      # API-client and form-logic tests
npm run build
```

Sign in with a seeded development user (see ../backend/README.md), e.g. `content@azharpark.test` (content manager) or `superadmin@azharpark.test` (roles). The menu shows only what your permissions allow; the server enforces them regardless.

Production: serve on its own origin (for example `admin.alazharpark.com`) and add that origin to the API's `CORS_ORIGINS`.

Browser tests for the portal and website together live in [../e2e](../e2e/README.md).
