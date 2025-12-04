const express = require("express");
const { Client } = require("pg");
const { encryptText, decryptText, randomSecret } = require("./utils/crypto");
const { startWhatsAppBot } = require("./bot-config/whatsapp");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Database connection
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

db.connect()
  .then(() => console.log("✅ Connected to Supabase PostgreSQL"))
  .catch((err) => console.error("❌ Database connection error:", err));

// Middleware validasi bot token multi-tenant
const validateBotToken = async (req, res, next) => {
  try {
    const token = req.headers["x-bot-token"];
    const userId = req.headers["x-user-id"];
    const channel = req.body?.channel || req.query?.channel;
    if (!token) {
      return res.status(401).json({ error: "Missing bot token" });
    }
    if (!userId) {
      // fallback: cari berdasar secret unik jika userId tidak disediakan
      const result = await db.query(
        "SELECT user_id, channel FROM bot_config WHERE webhook_secret = $1 AND status = 'active'",
        [token],
      );
      if (result.rowCount !== 1) {
        return res.status(401).json({ error: "Invalid or ambiguous bot token" });
      }
      req.tenant = { userId: result.rows[0].user_id, channel: result.rows[0].channel };
      return next();
    }
    if (!channel) {
      return res.status(400).json({ error: "Missing channel" });
    }
    const row = await db.query(
      "SELECT webhook_secret FROM bot_config WHERE user_id = $1 AND channel = $2 AND status = 'active'",
      [userId, channel],
    );
    if (row.rowCount === 0 || row.rows[0].webhook_secret !== token) {
      return res.status(401).json({ error: "Invalid bot token" });
    }
    req.tenant = { userId, channel };
    next();
  } catch (e) {
    res.status(500).json({ error: "Token validation failed" });
  }
};

// AI Response menggunakan OpenRouter
async function getAIResponse(message, customerName, channel) {
  try {
    const openrouterApiKey = process.env.OPENROUTER_API_KEY;

    if (!openrouterApiKey) {
      throw new Error("OpenRouter API key not configured");
    }

    const systemPrompt = `Kamu adalah bot customer service untuk UMKM. 
Bantu customer dengan ramah dan profesional. 
Kamu bisa membantu dengan:
- Info produk dan harga
- Status pesanan
- Cara pemesanan
- Promo dan diskon

Jawab dengan singkat dan jelas dalam Bahasa Indonesia.
Nama customer: ${customerName}
Channel: ${channel}`;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            process.env.APP_URL || "https://therra-bot.railway.app",
          "X-Title": "Therra UMKM Bot",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-3.1-8b-instruct:free",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      },
    );

    if (!response.ok) {
      throw new Error("OpenRouter API error");
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("AI Response error:", error);
    return "Maaf, saya sedang mengalami gangguan. Silakan hubungi admin atau coba lagi nanti.";
  }
}

// Detect intent dari message
function detectIntent(message) {
  const msg = message.toLowerCase();

  if (msg.includes("harga") || msg.includes("berapa")) return "product_inquiry";
  if (msg.includes("pesan") || msg.includes("beli") || msg.includes("order"))
    return "order";
  if (msg.includes("status") || msg.includes("pesanan saya"))
    return "order_status";
  if (msg.includes("promo") || msg.includes("diskon")) return "promo_inquiry";
  if (msg.includes("lokasi") || msg.includes("alamat")) return "location";
  if (msg.includes("jam") || msg.includes("buka")) return "business_hours";

  return "general";
}

// Webhook endpoint untuk menerima pesan dari bot WhatsApp/Telegram
app.post("/webhook", validateBotToken, async (req, res) => {
  try {
    const { channel, customerName, customerPhone, message } = req.body;

    if (!channel || !customerName || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get AI response
    const aiResponse = await getAIResponse(message, customerName, channel);
    const intent = detectIntent(message);

    // Return response immediately
    res.json({
      response: aiResponse,
      intent: intent,
    });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({
      response: "Maaf, terjadi kesalahan sistem. Silakan coba lagi.",
      error: error.message,
    });
  }
});

// Endpoint untuk logging ke database
app.post("/webhook/log", validateBotToken, async (req, res) => {
  try {
    const { channel, customerName, customerMessage, botResponse, intent } =
      req.body;

    await db.query(
      `INSERT INTO bot_logs (customer_name, customer_message, bot_response, channel, intent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        customerName,
        customerMessage,
        botResponse,
        channel,
        intent || "general",
      ],
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Log error:", error);
    res.status(500).json({ error: "Failed to log message" });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    database: db._connected ? "connected" : "disconnected",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Therra Bot Server running on port ${PORT}`);
  startWhatsAppBot();
});
// Telegram setup endpoint
app.post("/api/integrations/telegram/setup", async (req, res) => {
  try {
    const { userId, token } = req.body || {};
    if (!userId || !token) {
      return res.status(400).json({ error: "userId and token required" });
    }
    const meResp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (!meResp.ok) {
      return res.status(400).json({ error: "Invalid Telegram token" });
    }
    const meData = await meResp.json();
    const botId = meData?.result?.id?.toString();
    if (!botId) {
      return res.status(400).json({ error: "Failed to read bot id" });
    }
    const enc = encryptText(token);
    const secret = randomSecret();
    await db.query(
      `INSERT INTO bot_config(user_id, channel, bot_token, bot_id, webhook_secret, status)
       VALUES($1, 'telegram', $2, $3, $4, 'active')
       ON CONFLICT (user_id, channel) DO UPDATE SET bot_token = EXCLUDED.bot_token, bot_id = EXCLUDED.bot_id, webhook_secret = EXCLUDED.webhook_secret, updated_at = NOW()`,
      [userId, enc, botId, secret],
    );
    const appUrl = process.env.APP_URL || `http://127.0.0.1:${PORT}`;
    const webhookUrl = `${appUrl}/api/telegram/webhook/${userId}`;
    const setResp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, secret_token: secret })
    });
    const setData = await setResp.json();
    if (!setResp.ok || setData?.ok !== true) {
      return res.status(500).json({ error: "Failed to set webhook", details: setData });
    }
    res.json({ ok: true, botId });
  } catch (e) {
    res.status(500).json({ error: "Setup failed" });
  }
});

// Telegram webhook handler
app.post("/api/telegram/webhook/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
    if (!userId || !secretHeader) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const row = await db.query(
      "SELECT bot_token, webhook_secret FROM bot_config WHERE user_id = $1 AND channel = 'telegram' AND status = 'active'",
      [userId],
    );
    if (row.rowCount === 0) {
      return res.status(404).json({ error: "Bot not configured" });
    }
    const { bot_token, webhook_secret } = row.rows[0];
    if (secretHeader !== webhook_secret) {
      return res.status(401).json({ error: "Invalid signature" });
    }
    const update = req.body;
    const msg = update?.message;
    const chatId = msg?.chat?.id;
    const text = msg?.text;
    const name = msg?.from?.first_name || msg?.from?.username || String(chatId);
    if (!chatId || !text) {
      return res.json({ ok: true });
    }
    const reply = await getAIResponse(text, name, "telegram");
    await db.query(
      `INSERT INTO bot_logs (customer_name, customer_message, bot_response, channel, intent)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, text, reply, "telegram", detectIntent(text)],
    );
    const token = decryptText(bot_token);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: reply })
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Webhook handling failed" });
  }
});
