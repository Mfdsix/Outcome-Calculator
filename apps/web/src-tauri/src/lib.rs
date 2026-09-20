use scrypt::{password_hash::SaltString, scrypt};
use tauri_plugin_sql::{Migration, MigrationKind};

/// scrypt parameters — RFC 7914 interactive-login class (N=2^15, r=8, p=1).
/// A 6-char PIN screen gate does not need password-db-grade cost, but the
/// default keeps brute force expensive enough on device.
const SCRYPT_N: u32 = 1 << 15;
const SCRYPT_R: u32 = 8;
const SCRYPT_P: u32 = 1;
const KEY_LEN: usize = 32;

/// Hash a PIN with the caller-supplied hex salt (JS side generates it via
/// WebCrypto). Done natively so the gate never depends on WebCrypto being
/// in a secure context inside the WebView.
#[tauri::command]
fn hash_pin(pin: String, salt: String) -> Result<String, String> {
  let salt_bytes = hex::decode(&salt).map_err(|e| format!("invalid salt: {e}"))?;
  let salt_string =
    SaltString::encode_b64(&salt_bytes).map_err(|e| format!("invalid salt: {e}"))?;
  let params =
    scrypt::Params::new(SCRYPT_N.trailing_zeros() as u8, SCRYPT_R, SCRYPT_P, KEY_LEN)
      .map_err(|e| format!("invalid scrypt params: {e}"))?;
  let mut key = [0u8; KEY_LEN];
  scrypt(
    pin.as_bytes(),
    salt_string.as_str().as_bytes(),
    &params,
    &mut key,
  )
  .map_err(|e| format!("scrypt failed: {e}"))?;
  Ok(hex::encode(key))
}

/// Schema owned by the JS side (src/lib/repository/local.ts, src/lib/localConfig.ts).
/// All datetimes are UTC ISO-8601 strings; amounts are integer IDR > 0.
fn migrations() -> Vec<Migration> {
  vec![
    Migration {
      version: 1,
      description: "create expenses table",
      sql: "CREATE TABLE expenses (
              id TEXT PRIMARY KEY,
              amount INTEGER NOT NULL CHECK (amount > 0),
              occurred_at TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX idx_expenses_occurred_at ON expenses (occurred_at);",
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "create app_config key-value table",
      sql: "CREATE TABLE app_config (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );",
      kind: MigrationKind::Up,
    },
  ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:expense.db", migrations())
        .build(),
    )
    .invoke_handler(tauri::generate_handler![hash_pin])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
