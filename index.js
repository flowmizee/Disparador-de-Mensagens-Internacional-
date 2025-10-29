// index.js
import makeWASocket, {
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  delay,
  DisconnectReason
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

// 🔧 CONFIGURAÇÕES
const PASTA_ARQUIVOS = `${process.env.HOME}/storage/shared/Disparos`;
const INTERVALO_ENTRE_NUMEROS = 35000; // 35 segundos
const NUMEROS_FILE = 'numeros.txt';
const MENSAGENS_FILE = 'mensagens.txt';
const PRODUTOS_FILE = 'produtos.txt';
const ERROS_FILE = 'erros.txt';
const ENVIADOS_FILE = 'enviados.txt';
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
    n = n.slice(0, 4) + n.slice(5);
  }
  return n;
}

// 🚀 Iniciar WhatsApp com QR garantido
async function startWhatsApp(isReconnect = false) {
  if (!fs.existsSync('./auth_info')) {
    fs.mkdirSync('./auth_info', { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Flowmize', 'Chrome', '10.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !isReconnect) {
      console.clear();
      console.log('📱 Escaneie o QR code com o WhatsApp! (2 minutos de validade)');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log('❌ Conexão fechada');

      if (reason === DisconnectReason.loggedOut) {
        console.log('⚠️ Sessão expirada. Limpando auth_info...');
        fs.rmSync('./auth_info', { recursive: true, force: true });
        await delay(3000);
        await startWhatsApp(false);
      } else {
        console.log('🔄 Tentando reconectar em 5 segundos...');
        await delay(5000);
        await startWhatsApp(true);
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
  const primeiraExecucao = !fs.existsSync('./auth_info/creds.json');
  let sock = await startWhatsApp(!primeiraExecucao);

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
    console.log(`🔎 pais.txt detectado -> aplicando DDI padrão: ${DEFAULT_COUNTRY_CODE}`);
  }

  const numeros = fs.readFileSync(NUMEROS_FILE, 'utf-8')
    .split('\n')
    .map(n => normalizarNumero(n))
    .filter(n => n);

  const mensagens = fs.readFileSync(MENSAGENS_FILE, 'utf-8')
    .split(/\n(?=\d+\.)/)
    .map(m => m.replace(/^\d+\.\s*/, '').trim())
    .filter(m => m);

  const produtos = fs.readFileSync(PRODUTOS_FILE, 'utf-8')
    .split('\n')
    .map(p => p.trim())
    .filter(p => p);

  const enviados = fs.existsSync(ENVIADOS_FILE)
    ? fs.readFileSync(ENVIADOS_FILE, 'utf-8').split('\n').map(l => l.trim())
    : [];

  let msgIndex = 0;
  let produtoIndex = 0;

  for (const numero of numeros) {
    if (enviados.includes(numero)) {
      console.log(`⚡ Pulando ${numero} (já enviado)`);
      continue;
    }

    const jid = `${numero}@s.whatsapp.net`;
    const mensagem = mensagens[msgIndex % mensagens.length];
    const arquivo = produtos[produtoIndex % produtos.length];
    msgIndex++;
    produtoIndex++;

    console.log(`📤 Enviando para ${numero}...`);

    const caminho = path.join(PASTA_ARQUIVOS, arquivo);
    if (!fs.existsSync(caminho)) {
      console.log(`⚠️ Arquivo não encontrado: ${arquivo}`);
      continue;
    }

    const ext = path.extname(arquivo).toLowerCase();
    let enviado = false;

    for (let tent = 0; tent < 3 && !enviado; tent++) {
      try {
        if (['.mp3', '.wav', '.ogg'].includes(ext)) {
          await sock.sendMessage(jid, { audio: { url: caminho }, mimetype: 'audio/mpeg' });
          await sock.sendMessage(jid, { text: mensagem });
        } else if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
          await sock.sendMessage(jid, { image: { url: caminho }, caption: mensagem });
        } else if (['.mp4', '.mov', '.avi'].includes(ext)) {
          await sock.sendMessage(jid, { video: { url: caminho }, caption: mensagem });
        } else {
          await sock.sendMessage(jid, {
            document: { url: caminho },
            mimetype: 'application/octet-stream',
            fileName: arquivo
          });
          await sock.sendMessage(jid, { text: mensagem });
        }

        console.log(`📎 Enviado: ${arquivo}`);
        fs.appendFileSync(ENVIADOS_FILE, `${numero}\n`); // marca como enviado
        enviado = true;
        await delay(2000);
      } catch (err) {
        console.error(`⚠️ Erro ao enviar ${arquivo} para ${numero}:`, err.message);
        fs.appendFileSync(ERROS_FILE, `${numero} | ${arquivo} | ${err.message}\n`);
        console.log(`📝 Registrado no ${ERROS_FILE}`);

        console.log('⏳ Tentando reconectar e reenviar em 5 segundos...');
        await delay(5000);
        sock = await startWhatsApp(true);
      }
    }

    console.log(`⏱ Aguardando ${INTERVALO_ENTRE_NUMEROS / 1000}s antes do próximo número...`);
    await delay(INTERVALO_ENTRE_NUMEROS);
  }

  console.log('✅ Todos os envios foram concluídos!');
}

startBot();
