const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

const AUTH_DIR = path.join(__dirname, '..', 'data', 'baileys_auth');

class BaileysService {
  constructor() {
    this.sock = null;
    this.qrCodeUrl = null;
    this.qrString = null;
    this.status = 'DISCONNECTED'; // 'DISCONNECTED' | 'SCAN_QR' | 'CONNECTED'
    this.connectedNumber = null;
    this.retryCount = 0;
  }

  async init() {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['mybrotools', 'Chrome', '1.0.0']
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrString = qr;
          this.status = 'SCAN_QR';
          console.log('\n==================================================');
          console.log('📱 SCAN QR WHATSAPP (mybrotools) DI BAWAH INI:');
          console.log('==================================================');
          qrcodeTerminal.generate(qr, { small: true });
          console.log('Atau buka Admin Dashboard: http://localhost:3000/admin/index.html untuk scan dari browser.');
          console.log('==================================================\n');

          try {
            this.qrCodeUrl = await QRCode.toDataURL(qr, {
              errorCorrectionLevel: 'M',
              margin: 2,
              width: 250
            });
          } catch (e) {
            console.error('Failed to generate QR data URL:', e);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isSessionInvalid = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 440;
          this.status = 'DISCONNECTED';
          this.connectedNumber = null;
          console.log(`⚠️ WhatsApp terputus (status: ${statusCode}).`);

          if (isSessionInvalid) {
            console.log(`🔄 Sesi WhatsApp telah kedaluwarsa atau diganti (status ${statusCode}). Mereset sesi untuk memunculkan QR Code baru...`);
            if (fs.existsSync(AUTH_DIR)) {
              try {
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
              } catch (e) {}
            }
            this.retryCount = 0;
            setTimeout(() => this.init(), 2000);
            return;
          }

          if (this.retryCount < 5) {
            this.retryCount++;
            console.log(`⏳ Mencoba menyambung kembali (${this.retryCount}/5)...`);
            setTimeout(() => this.init(), 5000);
          }
        } else if (connection === 'open') {
          this.status = 'CONNECTED';
          this.qrCodeUrl = null;
          this.qrString = null;
          this.retryCount = 0;
          const userJid = this.sock.user?.id || '';
          this.connectedNumber = userJid.split(':')[0] || userJid.split('@')[0];
          console.log(`\n🎉 [WhatsApp] Berhasil Terhubung! Nomor aktif: ${this.connectedNumber} (mybrotools)\n`);
        }
      });
    } catch (err) {
      console.error('Error initializing Baileys WhatsApp:', err);
      this.status = 'DISCONNECTED';
    }
  }

  getStatus() {
    let statusFormatted = 'waiting_qr';
    if (this.status === 'CONNECTED') {
      statusFormatted = 'connected';
    } else if (this.status === 'DISCONNECTED' && !this.qrCodeUrl) {
      statusFormatted = 'disconnected';
    }

    return {
      status: statusFormatted,
      rawStatus: this.status,
      connectedNumber: this.connectedNumber,
      qrCodeUrl: this.qrCodeUrl
    };
  }

  /**
   * Send WhatsApp message to a phone number
   */
  async sendMessage(phone, message) {
    if (this.status !== 'CONNECTED' || !this.sock) {
      console.warn(`[WhatsApp] Belum bisa kirim WA ke ${phone} karena WhatsApp belum tersambung (Status: ${this.status}).`);
      return { success: false, reason: 'WhatsApp not connected' };
    }

    try {
      let cleaned = phone.replace(/[^0-9]/g, '');
      if (cleaned.startsWith('0')) {
        cleaned = '62' + cleaned.slice(1);
      } else if (!cleaned.startsWith('62')) {
        cleaned = '62' + cleaned;
      }

      const jid = `${cleaned}@s.whatsapp.net`;
      console.log(`[WhatsApp] Mengirim pesan otomatis dari mybrotools ke ${jid}...`);

      const result = await this.sock.sendMessage(jid, { text: message });
      console.log(`✅ [WhatsApp] Pesan sukses terkirim ke ${cleaned}!`);
      return { success: true, result };
    } catch (err) {
      console.error(`❌ [WhatsApp] Gagal mengirim pesan ke ${phone}:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Logout / reset WhatsApp session
   */
  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
      this.status = 'DISCONNECTED';
      this.connectedNumber = null;
      this.qrCodeUrl = null;
      setTimeout(() => this.init(), 1000);
      return { success: true };
    } catch (e) {
      console.error('Logout error:', e);
      return { success: false, error: e.message };
    }
  }
}

// Singleton instance
const baileysInstance = new BaileysService();

module.exports = baileysInstance;
