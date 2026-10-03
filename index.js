const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;
let isConnected = false;

function clearAuth() {
  if (fs.existsSync(AUTH_DIR)) {
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
  }
}

async function askAI(promptText) {
  const apiKey = process.env.GROQ_API_KEY || "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";

  const systemInstruction = `Kamu adalah asisten virtual AI cerdas yang ramah, profesional, dan serba bisa. Jawablah setiap pertanyaan pengguna secara fleksibel, ramah, dan informatif. Gunakan bahasa yang disesuaikan dengan pengguna (Bahasa Indonesia, Inggris, Jawa, dll).`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: promptText }
      ],
      temperature: 0.3,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "Maaf, layanan kami sedang tidak dapat memproses permintaan.";
}

async function initSocket() {
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (fs.existsSync(credsPath)) {
    try {
      const credsData = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
      if (!credsData.registered) clearAuth();
    } catch (e) {
      clearAuth();
    }
  }

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ["Mac OS", "Chrome", "121.0.6167.85"],
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`Koneksi Terputus: Status ${statusCode}`);

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 408) {
        clearAuth();
      }
      setTimeout(() => initSocket(), 5000);
    } else if (connection === 'open') {
      isConnected = true;
      console.log('\n==================================================');
      console.log('  BOT WHATSAPP 2 AKTIF!');
      console.log('==================================================\n');
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

    if (body) {
      try {
        const reply = await askAI(body);
        await sock.sendMessage(from, { text: reply });
      } catch (err) {
        console.error("Error AI:", err);
      }
    }
  });
}

initSocket();
