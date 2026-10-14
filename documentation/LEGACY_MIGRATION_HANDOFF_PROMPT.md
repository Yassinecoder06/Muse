# Handoff prompt: configure legacy-data migration

```text
Implement Muse’s secure-vault migration without losing any existing data.

Repository: /home/jmal/Projects/Muse

Current implementation:
- Supabase Auth email/password remains the fallback compatibility path.
- Ollama API keys are stored in Supabase Vault.
- Legacy user content remains server-encrypted with DATA_ENCRYPTION_KEY.
- Migration 008 adds user_vaults, webauthn_credentials,
  webauthn_challenges, and opaque AES-GCM vault_records.
- New browser vault records use a non-extractable IndexedDB CryptoKey and
  AES-256-GCM AAD bound to user ID, record ID, and version.

Required deployment/configuration outcome:
1. Back up Postgres and docker/pgsodium_root.key. Verify DATA_ENCRYPTION_KEY
   decrypts representative legacy notes, reports, research documents/artifacts,
   and images before migration.
2. Apply supabase/migrations/008_secure_vault.sql additively. Do not remove or
   overwrite legacy rows.
3. Set PUBLIC_URL, MUSE_SESSION_SECRET, and VAULT_LEGACY_MIGRATION=enabled.
   Configure WEBAUTHN_RP_ID, WEBAUTHN_RP_NAME, and WEBAUTHN_ORIGINS only when
   offering optional passkeys. Production WebAuthn requires HTTPS and an RP ID
   that matches the public hostname.
4. Build and deploy the server and client. Users complete Secure Vault setup,
   save their required 32-byte Base64URL AES recovery key, and may optionally
   add a passkey during setup or later.
   The AES key must never be copied to Vault, Postgres, logs, or email.
5. On the first unlocked browser, migrate data through the authenticated
   compatibility export. Preserve logical IDs, timestamps, note relations,
   tags/tasks, report output/metadata, attachments, favorite/archive/trash
   state, and research artifacts. Verify count parity and decryptability before
   user_vaults.migration_status becomes verified.
6. A new device enters the same recovery AES key, validates the vault-check
   envelope, and may create an additional passkey. It must not replace the AES
   key or re-encrypt all prior records.
7. Keep old server-encrypted rows and Qdrant vectors read-only until backups
   are independently validated and an administrator approves an explicit purge.
   Set VAULT_LEGACY_MIGRATION=disabled only after this decision; no automatic
   purge exists.

Before declaring success, run:
- npm test
- npm run build
- the verification queries in documentation/SECURITY_AND_MIGRATION.md

Report every migration command, required environment variable, count/decryption
verification result, and any manual administrator action. Do not log secrets or
raw recovery keys.
```
