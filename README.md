UMKM Bot Service (Railway)

Ringkasan
- Webhook bot untuk WhatsApp/Telegram yang memanggil AI via OpenRouter dan logging ke Supabase PostgreSQL.

Environment Variables
- Lihat `apps/railway-bot/.env.example` dan set di Railway.

Deploy ke Railway
- Root: `apps/railway-bot`
- Start command: `npm start`
- Persistent volume untuk Baileys: mount ke `/auth` jika menggunakan WhatsApp Web/Baileys.

Endpoint Penting
- `POST /webhook`
- `POST /webhook/log`
- `GET /health`

Verifikasi
- `GET /health` harus `status: ok` dan database `connected`.
- Telegram: `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getMe`.
- Dashboard: kirim sample POST ke `/api/bot/save-log`.

