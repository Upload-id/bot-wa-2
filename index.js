const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const http = require('http');

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
let pairingCode = "Sedang memproses... Refresh halaman ini beberapa detik lagi.";
let isConnected = false;

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

let sock = null;

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
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ["Ubuntu", "Chrome", "20.0.04"]
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
      pairingCode = "Bot WhatsApp Sudah Terhubung!";
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

// Server Web untuk Minta Kode via URL Alwaysdata
const PORT = process.env.PORT || 8100;
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const number = urlObj.searchParams.get("number");

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

  if (isConnected) {
    return res.end(`<h2>STATUS: BOT SUDAH TERHUBUNG KE WHATSAPP!</h2>`);
  }

  if (number) {
    try {
      if (sock && !sock.authState.creds.registered) {
        let code = await sock.requestPairingCode(number.replace(/[^0-9]/g, ''));
        pairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
      }
    } catch (err) {
      pairingCode = "Gagal mengambil kode: " + err.message;
    }
  }

  res.end(`
    <html>
      <head>
        <title>Pairing Bot WA 2</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: sans-serif; text-align: center; padding: 20px; background: #f4f4f9; }
          .card { background: white; padding: 20px; border-radius: 10px; display: inline-block; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          input, button { padding: 10px; font-size: 16px; margin: 5px; border-radius: 5px; border: 1px solid #ccc; }
          button { background: #25D366; color: white; border: none; cursor: pointer; font-weight: bold; }
          .code { font-size: 28px; font-weight: bold; color: #075e54; letter-spacing: 2px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Pairing Bot WhatsApp 2</h2>
          <form method="GET">
            <input type="text" name="number" placeholder="Contoh: 628123456789" required />
            <button type="submit">Dapatkan Kode</button>
          </form>
          <div class="code">${pairingCode}</div>
        </div>
      </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log(`Server HTTP berjalan di port ${PORT}`);
  initSocket();
});
