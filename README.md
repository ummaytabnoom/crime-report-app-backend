# Crime Report Backend

Minimal Node.js + Express + OracleDB backend.

## 1. Install

```bash
npm install
```

Copy `.env.example` to `.env` and keep your Oracle settings:

```env
DB_USER=system
DB_PASSWORD=a12345
DB_CONNECT_STRING=localhost:1521/xe
PORT=3000
```

## 2. Run

Development:

```bash
npm run dev
```

Normal:

```bash
npm start
```

## 3. Important design

No JWT and no token/session system is used.

After login, the client receives the user object. For protected requests, send:

```http
x-user-id: 123
```

The server looks up that user in Oracle and checks the user's current role.

This is intentionally simple, but it is NOT a secure authentication system for production because a client can change `x-user-id`.

Passwords are stored as bcrypt hashes, not plain text.

## 4. Crime workflow

`ACCEPTED` is moderation/public visibility:

- `Not Accepted`
- `Accepted`

`STATUS` is police investigation status:

- `Pending`
- `Accepted`
- `Under Investigation`

Therefore:

- A new report starts with `ACCEPTED = 'Not Accepted'`.
- Admin accepts a report by changing `ACCEPTED` to `Accepted`.
- `/api/crimes/global` returns only `ACCEPTED = 'Accepted'`.
- Police can change `STATUS`.
- Admin acceptance and police investigation status are separate.

## 5. API

### Auth

`POST /api/auth/register`

User example:

```json
{
  "full_name": "John Doe",
  "user_name": "john",
  "email": "john@example.com",
  "dob": "2000-01-01",
  "mobile": "01700000000",
  "role": "USER",
  "password": "123456"
}
```

Police example:

```json
{
  "full_name": "Police Officer",
  "user_name": "police01",
  "email": "police@example.com",
  "role": "POLICE",
  "police_id": "P001",
  "password": "123456"
}
```

For `POLICE`, `police_id` must already exist in `POLICE_INFO`.

`POST /api/auth/login`

```json
{
  "user_name": "john",
  "password": "123456"
}
```

`user_name` may also be an email.

### Current user

`GET /api/users/me`

Header:

```http
x-user-id: 1
```

### Admin users

`GET /api/users`

Header:

```http
x-user-id: ADMIN_USER_ID
```

`PATCH /api/users/:id/role`

```json
{
  "role": "POLICE"
}
```

`DELETE /api/users/:id`

### Crimes

`POST /api/crimes`

Header:

```http
x-user-id: USER_ID
```

Body:

```json
{
  "zilla": "Dhaka",
  "upazilla": "Dhanmondi",
  "police_station": "Dhanmondi",
  "area": "Road 5",
  "road_name": "Main Road",
  "road_no": "5",
  "date_of_incident": "2026-09-29",
  "category": "Theft",
  "description": "Description",
  "hide_identity": "NO",
  "media_type": "image/jpeg",
  "media_file": "BASE64_DATA"
}
```

`media_file` and `profile_picture` can be a normal base64 string or a data URL.

`GET /api/crimes/mine`

`GET /api/crimes/:id`

`PATCH /api/crimes/:id`

`DELETE /api/crimes/:id`

`GET /api/crimes/global`

Returns only accepted/public reports.

### Admin pending reports

`GET /api/crimes/pending`

Header:

```http
x-user-id: ADMIN_USER_ID
```

`PATCH /api/crimes/:id/accept`

Header:

```http
x-user-id: ADMIN_USER_ID
```

### Police

`GET /api/crimes/pending`

Header:

```http
x-user-id: POLICE_USER_ID
```

`PATCH /api/crimes/:id/status`

```json
{
  "status": "Under Investigation"
}
```

Allowed values:

- `Accepted`
- `Pending`
- `Under Investigation`

## 6. Folder structure

```text
crime-report-backend/
├── src/
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── crimeController.js
│   │   └── userController.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── crimeRoutes.js
│   │   └── userRoutes.js
│   ├── services/
│   │   ├── crimeService.js
│   │   └── userService.js
│   ├── app.js
│   ├── config.js
│   ├── db.js
│   ├── middleware.js
│   ├── server.js
│   └── utils.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```
