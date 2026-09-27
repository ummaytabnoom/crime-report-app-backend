# Crime Report Backend — Pure Node.js

Backend for the Crime Report App using:

- Node.js built-in `http` module
- Oracle Database through the official `oracledb` driver
- Native `crypto` for SHA-256 password hashing and HMAC JWT signing
- Native `fs` for evidence-file handling
- No Express
- No Fastify
- No NestJS
- No web framework

## Database

This backend targets the existing tables:

- `POLICE_INFO`
- `REGISTERED_USERS`
- `REPORTED_CRIMES`

It does not require a schema rewrite.

## Setup

1. Install Node.js 18+.
2. Install Oracle client prerequisites required by the `oracledb` package.
3. Copy `.env.example` to `.env`.
4. Put your Oracle credentials in `.env`.
5. Install dependencies:

```bash
npm install
```

6. Start:

```bash
npm start
```

Development:

```bash
npm run dev
```

## API

### Public

`GET /api/health`

`POST /api/auth/register`

Example:

```json
{
  "fullName": "Test User",
  "userName": "testuser",
  "email": "test@example.com",
  "password": "secret123",
  "dob": "2000-01-01",
  "mobile": "01700000000",
  "role": "USER"
}
```

`POST /api/auth/login`

```json
{
  "userName": "testuser",
  "password": "secret123"
}
```

The login response returns a Bearer token.

### Authenticated user

`GET /api/me`

`POST /api/crimes`

`GET /api/crimes/my`

`GET /api/crimes/:crimeId`

### Admin

`GET /api/crimes`

`GET /api/police`

`PATCH /api/admin/crimes/:crimeId/accept`

```json
{}
```

`PATCH /api/admin/crimes/:crimeId/assign`

```json
{
  "policeId": "P001"
}
```

`DELETE /api/admin/users/:id`

### Police/Admin

`PATCH /api/crimes/:crimeId/status`

```json
{
  "status": "Under Investigation"
}
```

## Authentication

Send:

```text
Authorization: Bearer YOUR_TOKEN
```

## Important security note

The original JSP project contains database credentials directly in JSP files. This backend deliberately moves credentials to `.env`.

For production, consider replacing SHA-256 password storage with a slow password-hashing algorithm such as Argon2 or bcrypt. This initial version keeps SHA-256 so existing passwords from the original application can remain compatible while we migrate the authentication system.

## Next modules

The backend can be extended with:

- profile picture upload
- police profile management
- admin user management
- crime deletion
- report rejection
- case history/audit table
- refresh tokens
- validation layer
- rate limiting
- static frontend serving