// index.js
import makeWASocket, { fetchLatestBaileysVersion, useMultiFileAuthState, delay, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

// 🔧 CONFIGURAÇÕES
const PASTA_ARQUIVOS = `${process.env.HOME}/storage/shared/Disparos`; 
const INTERVALO_ENTRE_NUMEROS = 30000; // 30 segundos entre números
const NUMEROS_FILE = 'numeros.txt';
const LEGENDA_FILE = 'legenda.txt';
const PRODUTOS_FILE = 'produtos.txt';
const ERROS_FILE = 'erros.txt';
const PAIS_FILE = 'pais.txt';

// Mapa ISO -> DDI
const ISO_TO_CODE = {
  BR: '55', US: '1', GB: '44', CA: '1', AU: '61', ES: '34', MX: '52', PT: '351', DE: '49', IT: '39',
  RU: '7', ZA: '27'
};

// 🔹 Lê pais.txt e retorna DDI
function readDefaultCountryCode() {
  try {
    if (!fs.existsSync(PAIS_FILE)) return null;
    const raw = fs.readFileSync(PAIS_FILE, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .find(l => l && !l.startsWith('#'));
    if (!raw) return null;

    const digits = raw.replace(/\D/g, '');
    if (digits) return digits;

    const iso = raw.toUpperCase();
    return ISO_TO_CODE[iso] || null;
  } catch (err) {
    console.error('Erro lendo pais.txt:', err);
    return null;
  }
}

const DEFAULT_COUNTRY_CODE = readDefaultCountryCode();

// 🔹 Normaliza números para WhatsApp
function normalizarNumero(numero) {
  if (!numero) return '';
  let n = String(numero).replace(/\D/g, '');
  if (numero.startsWith('+')) {
    n = n;
  } else if (DEFAULT_COUNTRY_CODE) {
    n = DEFAULT_COUNTRY_CODE + n;
  }
  if (n.startsWith('55') && n.length === 13 && n[4] === '9') {
    n = n.slice(0,4) + n.slice(5);
  }
  return n;
}

// 🚀 Iniciar WhatsApp com reconexão
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('📱 Escaneie o QR code com o WhatsApp!');
    }

    if (connection === 'close') {
      console.log('❌ Conexão fechada');
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log('🔄 Tentando reconectar em 5 segundos...');
        await delay(5000);
        await startWhatsApp(); // Reconnect
      }
    } else if (connection === 'open') {
      console.log('✅ Conectado ao WhatsApp!');
    }
  });

  sock.ev.on('creds.update', saveCreds);
  return sock;
}

// 🧠 Função principal
async function startBot() {
  let sock = await startWhatsApp();

  console.log('⏳ Aguardando conexão...');
  await new Promise((resolve) => {
    const listener = (update) => {
      if (update.connection === 'open') {
        sock.ev.off('connection.update', listener);
        resolve();
      }
    };
    sock.ev.on('connection.update', listener);
  });

  console.log('🚀 Conexão estabelecida!');
  if (DEFAULT_COUNTRY_CODE) {
    console.log(`🔎 pais.txt detectado -> aplicando DDI padrão: ${DEFAULT_COUNTRY_CODE} para números sem código.`);
  }

  const numeros = fs.readFileSync(NUMEROS_FILE, 'utf-8')
                     .split('\n')
                     .map(n => normalizarNumero(n))
                     .filter(n => n);

  const legenda = fs.readFileSync(LEGENDA_FILE, 'utf-8').trim();

  const produtos = fs.readFileSync(PRODUTOS_FILE, 'utf-8')
                      .split('\n')
                      .map(p => p.trim())
                      .filter(p => p);

  for (const numero of numeros) {
    const jid = `${numero}@s.whatsapp.net`;
    console.log(`📤 Enviando para ${numero}...`);

    for (const arquivo of produtos) {
      const caminho = path.join(PASTA_ARQUIVOS, arquivo);
      if (!fs.existsSync(caminho)) {
        console.log(`⚠️ Arquivo não encontrado: ${arquivo}`);
        continue;
      }

      const ext = path.extname(arquivo).toLowerCase();
      let enviado = false;

      // Tentativa com reconexão automática
      for (let tent = 0; tent < 3 && !enviado; tent++) {
        try {
          if (['.mp3', '.wav', '.ogg'].includes(ext)) {
            await sock.sendMessage(jid, { audio: { url: caminho }, mimetype: 'audio/mpeg' });
            await sock.sendMessage(jid, { text: legenda });
          } else if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
            await sock.sendMessage(jid, { image: { url: caminho }, caption: legenda });
          } else if (['.mp4', '.mov', '.avi'].includes(ext)) {
            await sock.sendMessage(jid, { video: { url: caminho }, caption: legenda });
          } else {
            await sock.sendMessage(jid, { document: { url: caminho }, mimetype: 'application/octet-stream', fileName: arquivo });
            await sock.sendMessage(jid, { text: legenda });
          }

          console.log(`📎 Arquivo enviado: ${arquivo}`);
          enviado = true;
          await delay(2000);
        } catch (err) {
          console.error(`⚠️ Erro ao enviar ${arquivo} para ${numero}:`, err);
          const erroMsg = `${numero} | ${arquivo} | ${err.message}\n`;
          fs.appendFileSync(ERROS_FILE, erroMsg);
          console.log(`📝 Registrado no ${ERROS_FILE}`);

          console.log('⏳ Tentando reconectar e reenviar em 5 segundos...');
          await delay(5000);
          sock = await startWhatsApp();
        }
      }

      if (!enviado) {
        console.log(`❌ Falha ao enviar ${arquivo} para ${numero} após 3 tentativas.`);
      }
    }

    console.log(`⏱ Aguardando ${INTERVALO_ENTRE_NUMEROS / 1000}s antes do próximo número...`);
    await delay(INTERVALO_ENTRE_NUMEROS);
  }

  console.log('✅ Todos os envios foram concluídos!');
}

startBot();
