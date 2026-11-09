-- =====================================================================
-- Libra Logger — MySQL schema (MySQL 8, Railway)
-- Based on SE_Resources/Logical_View.png and Component_Diagram.png.
-- Column names match the JSON fields used by Application/shared/api.js,
-- so rows can be returned to the frontend as-is.
--
-- Run on Railway:  mysql -h $MYSQLHOST -P $MYSQLPORT -u $MYSQLUSER -p$MYSQLPASSWORD $MYSQLDATABASE < schema.sql
-- =====================================================================

SET NAMES utf8mb4;

-- ---------- Account and security ----------

CREATE TABLE IF NOT EXISTS users (
  user_ID        INT AUTO_INCREMENT PRIMARY KEY,
  user_name      VARCHAR(60)  NOT NULL,
  user_email     VARCHAR(255) NOT NULL UNIQUE,
  hash_password  VARCHAR(255) NOT NULL,          -- bcrypt/argon2 hash, never plain text
  is_verified    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  token_ID    INT AUTO_INCREMENT PRIMARY KEY,
  user_ID     INT NOT NULL,
  type        ENUM('EMAIL', 'SMS_2FA') NOT NULL,
  code        VARCHAR(128) NOT NULL,
  expires_at  DATETIME NOT NULL,
  FOREIGN KEY (user_ID) REFERENCES users(user_ID) ON DELETE CASCADE
);

-- "User Settings" table in the Component Diagram
CREATE TABLE IF NOT EXISTS profiles (
  profile_ID       INT AUTO_INCREMENT PRIMARY KEY,
  user_ID          INT NOT NULL UNIQUE,
  nickname         VARCHAR(30),
  birthday         DATE,
  profile_picture  MEDIUMTEXT,                    -- data URL or object-storage URL
  profile_icon     VARCHAR(50),
  profile_color    CHAR(7)  DEFAULT '#5fe0b7',
  profile_border   CHAR(7)  DEFAULT '#e87500',
  status_2FA       BOOLEAN  NOT NULL DEFAULT FALSE,
  FOREIGN KEY (user_ID) REFERENCES users(user_ID) ON DELETE CASCADE
);

-- ---------- Core budget data ----------

CREATE TABLE IF NOT EXISTS categories (
  category_ID  INT AUTO_INCREMENT PRIMARY KEY,
  user_ID      INT NULL,                          -- NULL = default category shared by everyone
  name         VARCHAR(50) NOT NULL,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (user_ID) REFERENCES users(user_ID) ON DELETE CASCADE
);

-- "Purchases" table. Subscriptions are purchases with recurring = TRUE.
CREATE TABLE IF NOT EXISTS purchases (
  purchase_ID    INT AUTO_INCREMENT PRIMARY KEY,
  user_ID        INT NOT NULL,
  name           VARCHAR(100) NOT NULL,
  amount         DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  date           DATE NOT NULL,
  description    VARCHAR(255) DEFAULT '',
  recurring      BOOLEAN NOT NULL DEFAULT FALSE,
  frequency      ENUM('WEEKLY', 'MONTHLY', 'YEARLY') NULL,   -- Subscription.frequency
  next_due_date  DATE NULL,                                  -- Subscription.next_due_date
  category_ID    INT NULL,
  is_refunded    BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (user_ID) REFERENCES users(user_ID) ON DELETE CASCADE,
  FOREIGN KEY (category_ID) REFERENCES categories(category_ID) ON DELETE SET NULL,
  INDEX idx_purchases_user_date (user_ID, date)
);

CREATE TABLE IF NOT EXISTS receipts (
  receipt_ID   INT AUTO_INCREMENT PRIMARY KEY,
  user_ID      INT NOT NULL,
  image_data   MEDIUMBLOB,
  upload_date  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',     -- PENDING / PARSED / FAILED
  FOREIGN KEY (user_ID) REFERENCES users(user_ID) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS budgets (
  budget_ID        INT AUTO_INCREMENT PRIMARY KEY,
  user_ID          INT NOT NULL,
  period           ENUM('WEEKLY', 'MONTHLY') NOT NULL DEFAULT 'MONTHLY',
  limit_amount     DECIMAL(10, 2) NOT NULL,
  alert_threshold  TINYINT UNSIGNED NOT NULL DEFAULT 80,   -- percent
  category_ID      INT NULL,                               -- NULL = overall budget
  FOREIGN KEY (user_ID) REFERENCES users(user_ID) ON DELETE CASCADE,
  FOREIGN KEY (category_ID) REFERENCES categories(category_ID) ON DELETE CASCADE
);
-- current_spent is computed from purchases (see computeBudgetStatus in api.js), not stored.

-- ---------- Feedback and reporting ----------

CREATE TABLE IF NOT EXISTS alerts (
  alert_ID    INT AUTO_INCREMENT PRIMARY KEY,
  budget_ID   INT NOT NULL,
  type        ENUM('NEAR_80', 'EXCEEDED_100') NOT NULL,
  message     VARCHAR(255) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dismissed   BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (budget_ID) REFERENCES budgets(budget_ID) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS streaks (
  streak_ID           INT AUTO_INCREMENT PRIMARY KEY,
  user_ID             INT NOT NULL UNIQUE,
  weeks_under_budget  INT NOT NULL DEFAULT 0,
  last_updated        DATE,
  FOREIGN KEY (user_ID) REFERENCES users(user_ID) ON DELETE CASCADE
);

-- ---------- Student resources ----------

CREATE TABLE IF NOT EXISTS resources (
  resource_ID     INT AUTO_INCREMENT PRIMARY KEY,
  resource_name   VARCHAR(100) NOT NULL,
  category        VARCHAR(30),                   -- Aid / Food / Tips (filter on Resources page)
  description     VARCHAR(255),
  resource_link   VARCHAR(500) NOT NULL,
  resource_image  VARCHAR(500)
);

-- ---------- Seed data ----------

INSERT INTO categories (category_ID, user_ID, name, is_default) VALUES
  (1, NULL, 'Food & Dining', TRUE),
  (2, NULL, 'Groceries', TRUE),
  (3, NULL, 'Transportation', TRUE),
  (4, NULL, 'Entertainment', TRUE),
  (5, NULL, 'School', TRUE),
  (6, NULL, 'Subscriptions', TRUE),
  (7, NULL, 'Housing', TRUE),
  (8, NULL, 'Other', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name);
