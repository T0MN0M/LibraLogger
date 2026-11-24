# Libra Logger — Database (MySQL on Railway)

`schema.sql` creates every table from the Logical View (`SE_Resources/Logical_View.png`).

## How the frontend connects

The pages in `Application/` never touch the database directly. They all go through
`Application/shared/api.js` (`window.LibraAPI`), which has two modes:

| Mode | What it does |
|------|--------------|
| `remote` (current) | Calls the Node.js server (`server.js`) over REST; the server queries MySQL. |
| `mock` | Sample data saved in the browser's `localStorage`. For opening the HTML files without a server. |

In remote mode every user has their own data:

- **Login** (`POST /api/auth/login`) checks the scrypt hash in `users.hash_password` and sets an
  HttpOnly `libra_session` cookie. Only a SHA-256 hash of that token is stored, in the `sessions` table.
- **Every data route** (`/api/purchases`, `/api/budget`, `/api/profile`, ...) reads the user from
  the session cookie and only touches that user's rows. Requests without a valid session get a 401,
  and `api.js` sends the browser to the login page.
- **New accounts start empty.** Registration only creates the `users` and `profiles` rows, so a
  new user has no purchases, the default $100 monthly budget (the API returns `limit_amount: 100`
  until they change it) and a 0-week streak.
  Categories and resources are shared by everyone.

Server routes are listed in `server.js` (`API_ROUTES`), with their logic in `backend/`.
The JSON field names match the column names in `schema.sql`.

## Setting up on Railway

1. In the Railway project, add a **MySQL** service.
2. Load the schema. `server.js` runs `schema.sql` automatically on every startup (every statement
   in it is safe to re-run), or you can load it by hand (Railway shows these variables on the MySQL service):
   ```sh
   mysql -h $MYSQLHOST -P $MYSQLPORT -u $MYSQLUSER -p$MYSQLPASSWORD $MYSQLDATABASE < Database/schema.sql
   ```
3. In the Node.js service, reference the MySQL variables (or `MYSQL_URL`) and connect with
   a library like `mysql2`. Never commit passwords — keep them in Railway variables.
4. Store passwords only as hashes (`users.hash_password`) and use a session cookie for login;
   `api.js` already sends `credentials: "include"` on every request.
