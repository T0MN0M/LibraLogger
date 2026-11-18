# Libra Logger — Database (MySQL on Railway)

`schema.sql` creates every table from the Logical View (`SE_Resources/Logical_View.png`).

## How the frontend connects

The pages in `Application/` never touch the database directly. They all go through
`Application/shared/api.js` (`window.LibraAPI`), which has two modes:

| Mode | What it does |
|------|--------------|
| `mock` (current) | Sample data saved in the browser's `localStorage`. Just open the HTML files. |
| `remote` | Calls a Node.js server (on Railway) over REST; the server queries MySQL. |

Endpoints can also go live one at a time: any name in `LIBRA_CONFIG.remoteEndpoints` always
uses the server, even in mock mode. **Registration (`register` → `POST /api/auth/register`) is
already live this way.** It inserts a `users` row (password hashed with scrypt, see
`backend/passwords.js`) and a matching `profiles` row with the birthday. Server routes are in
`server.js` (`API_ROUTES`), with their logic in `backend/`.

To go fully live, change `LIBRA_CONFIG.mode` to `"remote"` in `api.js` and build a server that
implements the endpoints in the `ENDPOINTS` table at the top of that file
(e.g. `GET /api/purchases`, `PUT /api/budget`). The JSON field names already match the
column names in `schema.sql`, so the server can return rows as-is.

## Setting up on Railway

1. In the Railway project, add a **MySQL** service.
2. Load the schema (Railway shows these variables on the MySQL service):
   ```sh
   mysql -h $MYSQLHOST -P $MYSQLPORT -u $MYSQLUSER -p$MYSQLPASSWORD $MYSQLDATABASE < Database/schema.sql
   ```
3. In the Node.js service, reference the MySQL variables (or `MYSQL_URL`) and connect with
   a library like `mysql2`. Never commit passwords — keep them in Railway variables.
4. Store passwords only as hashes (`users.hash_password`) and use a session cookie for login;
   `api.js` already sends `credentials: "include"` on every request.
