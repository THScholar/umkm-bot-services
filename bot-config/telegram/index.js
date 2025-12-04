const TelegramBot = require('node-telegram-bot-api');

function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const bot = new TelegramBot(token, { polling: true });
  const baseUrl = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  const botToken = process.env.BOT_SECRET_TOKEN || 'THERRA_TOKEN';

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from?.first_name || msg.from?.username || String(chatId);
    const text = msg.text || '';
    if (!text) return;

    try {
      const resp = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Token': botToken },
        body: JSON.stringify({ channel: 'telegram', customerName: userName, customerPhone: String(chatId), message: text })
      });
      const data = await resp.json();
      const reply = data.response || 'Terima kasih.';
      await bot.sendMessage(chatId, reply);
      await fetch(`${baseUrl}/webhook/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Token': botToken },
        body: JSON.stringify({ channel: 'telegram', customerName: userName, customerMessage: text, botResponse: reply, intent: data.intent || 'general' })
      });
    } catch (e) {}
  });
}

module.exports = { startTelegramBot };
