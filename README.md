# FV Bank — Registro de Accesos

App de STRATOS Consulting Group para documentar qué empleado tiene qué
nivel de permiso (Admin / User) en cada aplicación, con bitácora de
auditoría completa (altas, cambios, bajas, eliminaciones).

## 1. Crear el proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) → New Project.
2. Cuando esté listo, entra a **SQL Editor** → New query.
3. Pega y corre todo el contenido de `supabase/schema.sql`.
4. En una nueva query, pega y corre `supabase/seed.sql` (carga tus 64
   empleados, 58 apps y ~315 permisos actuales).
5. Ve a **Project Settings → API** y copia el `Project URL` y el
   `anon public key`.

## 2. Crear tu usuario (no hay registro público)

Ve a **Authentication → Users → Add user** y créate a ti mismo con tu
correo y una contraseña. Cualquier usuario que agregues ahí puede
entrar a la app — es la forma de darle acceso a alguien más del
equipo o, si decides compartirlo, a alguien de FV Bank.

## 3. Configurar el proyecto localmente

```bash
git clone <tu-repo-recien-creado>
cd fvbank-access-control
npm install
cp .env.example .env
```

Edita `.env` y pon el `Project URL` y `anon key` que copiaste en el
paso 1.

```bash
npm run dev
```

Abre `http://localhost:5173`, entra con el usuario que creaste en el
paso 2.

## 4. Subir a tu GitHub

```bash
git init
git add .
git commit -m "Setup inicial: FV Bank access control"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/fvbank-access-control.git
git push -u origin main
```

(El `.gitignore` ya excluye `.env` y `node_modules`, así que tu
`anon key` no se sube al repo — igual, el anon key no es secreto,
pero mejor no exponerlo sin necesidad.)

## 5. Desplegar en Vercel

1. En [vercel.com](https://vercel.com) → Add New → Project → importa
   el repo que acabas de subir.
2. En **Environment Variables**, agrega `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY` con los mismos valores de tu `.env`.
3. Deploy. Cada push a `main` despliega automáticamente.

## Cómo funciona la auditoría

Hay dos bitácoras:

- **`audit_log`** — la que ves en la pestaña "Bitácora de Auditoría"
  de la app. Mensajes legibles ("Se agregó a Juan Pérez...").
- **`audit_log_raw`** — se llena sola vía trigger de Postgres en
  cada INSERT/UPDATE/DELETE de `employees`, `apps` y `permissions`.
  Nadie puede escribir ahí directo (ni siquiera la app) — solo el
  trigger. Sirve de respaldo tamper-evident aunque alguien edite la
  base de datos por fuera de la app.

## Seguridad (importante antes de compartir con el cliente)

- Row Level Security está activado en todas las tablas: solo
  usuarios autenticados (los que crees en el paso 2) pueden leer o
  escribir. No hay acceso anónimo ni registro público.
- v1 da acceso completo a cualquier usuario autenticado. Si vas a
  compartir esto con alguien de FV Bank que solo debería *ver* pero
  no editar, hay que añadir un rol de "solo lectura" antes — avísame
  cuando llegues a ese punto y ajustamos las políticas RLS.
- Antes de compartir con el cliente, considera activar 2FA en los
  usuarios de Supabase Auth dado que esto maneja datos de acceso
  administrativo bancario.


https://revjrzatwbsrtnebzbil.supabase.co
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJldmpyemF0d2JzcnRuZWJ6YmlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxNjMyMDMsImV4cCI6MjEwMjczOTIwM30.IFUqNmT3uIdpyeVIM_b0yfVTlAY7HIbPM9GP9eBjs98
