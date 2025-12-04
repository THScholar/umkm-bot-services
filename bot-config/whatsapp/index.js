const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');

const sessions = new Map();

async function startWhatsAppSession(userId, secret) {
  const baseUrl = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  const sessionRoot = process.env.WA_SESSION_PATH || './auth';
  const sessionPath = `${sessionRoot}/${userId}`;
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();
  let sock = makeWASocket({ auth: state, version, printQRInTerminal: true, syncFullHistory: false });
  sessions.set(userId, sock);
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        startWhatsAppSession(userId, secret);
      }
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const m = messages[0];
    if (!m || !m.message) return;
    const remoteJid = m.key.remoteJid;
    const pushName = m.pushName || remoteJid;
    const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
    if (!text) return;
    try {
      const resp = await fetch(`${baseUrl}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Token': secret, 'X-User-Id': userId },
        body: JSON.stringify({ channel: 'whatsapp', customerName: pushName, customerPhone: remoteJid, message: text })
      });
      const data = await resp.json();
      const reply = data.response || 'Terima kasih.';
      await sock.sendMessage(remoteJid, { text: reply });
      await fetch(`${baseUrl}/webhook/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bot-Token': secret, 'X-User-Id': userId },
        body: JSON.stringify({ channel: 'whatsapp', customerName: pushName, customerMessage: text, botResponse: reply, intent: data.intent || 'general' })
      });
    } catch (e) {}
  });
  return { started: true };
}

module.exports = { startWhatsAppSession };
