const express = require("express");
const { Client } = require("pg");

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

// Middleware untuk validasi bot token
const validateBotToken = (req, res, next) => {
  const token = req.headers["x-bot-token"];
  if (!token || !token.startsWith("THERRA_")) {
    return res.status(401).json({ error: "Invalid bot token" });
  }
  req.botToken = token;
  next();
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
});
