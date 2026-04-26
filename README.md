# Padel Complex - Sistema de Reservas

Aplicación web para gestión de canchas deportivas (pádel y fútbol) con sistema de reservas.

## Tecnologías

- **Backend**: AdonisJS v6 + TypeScript
- **Frontend**: React + Vite + Tailwind CSS
- **Base de datos**: MySQL

## Estructura del proyecto

```
padel/
├── backend/   # API REST - AdonisJS v6
└── frontend/  # SPA - React + Vite
```

## Setup

### 1. Base de datos MySQL

Crear la base de datos:
```sql
CREATE DATABASE padel_complex CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Backend

```bash
cd backend

# Configurar variables de entorno
# Editar .env con tus credenciales MySQL:
# DB_HOST=127.0.0.1
# DB_PORT=3306
# DB_USER=root
# DB_PASSWORD=tu_password
# DB_DATABASE=padel_complex

# Correr migraciones
npm run migrate

# Correr seeders (crea canchas y usuarios de prueba)
npm run seed

# Iniciar servidor de desarrollo
npm run dev
```

El backend corre en `http://localhost:3333`

### 3. Frontend

```bash
cd frontend
npm run dev
```

El frontend corre en `http://localhost:5173`

## Usuarios de prueba (seeder)

| Email | Password | Rol |
|-------|----------|-----|
| admin@padel.com | admin123 | Administrador |
| worker@padel.com | worker123 | Empleado |
| *(registrarse)* | *(libre)* | Cliente |

## Roles y permisos

| Feature | Admin | Empleado | Cliente |
|---------|-------|----------|---------|
| Ver canchas | ✅ | ✅ | ✅ |
| Crear/editar canchas | ✅ | ✅ | ❌ |
| Eliminar canchas | ✅ | ✅ | ❌ |
| Ver todas las reservas | ✅ | ✅ | Solo propias |
| Crear reservas | ✅ | ✅ | ✅ |
| Confirmar/cancelar reservas | ✅ | ✅ | Solo propias pendientes |
| Gestionar usuarios | ✅ | ❌ | ❌ |

## API Endpoints

```
POST   /api/v1/auth/signup          - Registro
POST   /api/v1/auth/login           - Login
POST   /api/v1/account/logout       - Logout
GET    /api/v1/account/profile      - Perfil propio

GET    /api/v1/courts               - Listar canchas
POST   /api/v1/courts               - Crear cancha [admin, worker]
PUT    /api/v1/courts/:id           - Editar cancha [admin, worker]
DELETE /api/v1/courts/:id           - Eliminar cancha [admin, worker]
PATCH  /api/v1/courts/:id/toggle    - Activar/desactivar [admin, worker]

GET    /api/v1/reservations         - Listar reservas
POST   /api/v1/reservations         - Crear reserva
PUT    /api/v1/reservations/:id     - Editar/cambiar estado
DELETE /api/v1/reservations/:id     - Cancelar reserva

GET    /api/v1/users                - Listar usuarios [admin]
PUT    /api/v1/users/:id            - Editar usuario [admin]
DELETE /api/v1/users/:id            - Eliminar usuario [admin]
```
