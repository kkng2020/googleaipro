const axios = require('axios');
let baileys = {
  status: 'DISCONNECTED',
  sendMessage: async () => ({ success: false })
};

if (!process.env.VERCEL) {
  try {
    baileys = require('./baileys');
  } catch (err) {
    console.warn('[WhatsApp Service] Baileys bypass:', err.message);
  }
}

function formatWhatsAppNumber(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  } else if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
}

function buildPaymentInstructionMessage({ orderId, buyerName, total, paymentUrl, orderWebUrl, storeName = 'mybrotools' }) {
  const webUrl = orderWebUrl || `${process.env.BASE_URL || 'http://localhost:3000'}/?order=${orderId}`;
  return `Halo Kak ${buyerName || 'Pelanggan'}! 👋

Terima kasih telah memesan *Voucher Google AI Pro* di *${storeName}* ✨

Berikut adalah link pesanan & pembayaran resmi Anda:

📋 *RINCIAN PESANAN:*
• No. Pesanan   : ${orderId}
• Total Tagihan : Rp ${Number(total).toLocaleString('id-ID')}
• Status        : MENUNGGU PEMBAYARAN ⏳

🌐 *LINK HALAMAN PESANAN & VOUCHER ANDA:*
${webUrl}

🔗 *LINK PEMBAYARAN QRIS (BuatQris):*
${paymentUrl}

💡 *PANDUAN:*
1. Selesaikan pembayaran melalui link QRIS di atas atau scan QRIS yang tampil di layar.
2. Link halaman pesanan Anda (${webUrl}) akan *otomatis berubah menjadi halaman klaim voucher Google AI Pro* begitu pembayaran Anda terverifikasi lunas!

Jika butuh bantuan, silakan langsung balas pesan ini ya Kak. Terima kasih! 🙏`;
}

function buildThankYouMessage({ orderId, buyerName, amount, voucherUrl, historyUrl, storeName = 'mybrotools' }) {
  return `Halo Kak ${buyerName || 'Pelanggan'}! 👋

Terima kasih banyak telah berbelanja di *${storeName}* 🙏✨
Pembayaran Anda sebesar *Rp ${Number(amount).toLocaleString('id-ID')}* telah kami terima dan *LUNAS* secara otomatis.

📋 *RINCIAN PESANAN ANDA:*
• No. Pesanan : ${orderId}
• Produk      : Voucher Google AI Pro Resmi
• Status      : PEMBAYARAN BERHASIL ✅

🚀 *LINK KLAIM VOUCHER GOOGLE AI PRO ANDA:*
${voucherUrl}

📄 *LINK HISTORY & BUKTI STRUK:*
${historyUrl}

💡 *PANDUAN KLAIM:*
1. Buka link klaim di atas pada browser Anda.
2. Login ke akun Google yang ingin Anda aktifkan benefitnya.
3. Ikuti petunjuk aktivasi langsung di layar dan nikmati fitur Gemini Advanced & Google One!

Jika ada pertanyaan atau butuh bantuan, silakan langsung balas chat ini ya Kak. Terima kasih banyak dan sukses selalu! 😊`;
}

function generateWaLink({ phone, message }) {
  const formattedPhone = formatWhatsAppNumber(phone);
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${formattedPhone}?text=${encoded}`;
}

/**
 * Send WhatsApp payment instruction link automatically via Baileys (primary) or Fonnte (fallback)
 */
async function sendPaymentInstructionNotification({ phone, orderId, buyerName, total, paymentUrl, orderWebUrl, storeName = 'mybrotools' }) {
  const formattedPhone = formatWhatsAppNumber(phone);
  if (!formattedPhone) return { success: false, reason: 'No phone number' };

  const message = buildPaymentInstructionMessage({
    orderId,
    buyerName,
    total,
    paymentUrl,
    orderWebUrl,
    storeName
  });

  const waLink = generateWaLink({ phone: formattedPhone, message });

  // 1. Try Baileys (Self-Hosted WhatsApp)
  if (baileys.status === 'CONNECTED') {
    const bResult = await baileys.sendMessage(formattedPhone, message);
    if (bResult.success) {
      return { success: true, provider: 'baileys', waLink, message };
    }
  }

  // 2. Fallback to Fonnte if token is set
  const fonnteToken = process.env.FONNTE_TOKEN;
  if (fonnteToken) {
    try {
      console.log(`[WhatsApp] Mengirim instruksi bayar via Fonnte ke ${formattedPhone}...`);
      await axios.post(
        'https://api.fonnte.com/send',
        {
          target: formattedPhone,
          message: message,
          countryCode: '62'
        },
        {
          headers: { Authorization: fonnteToken },
          timeout: 10000
        }
      );
      return { success: true, provider: 'fonnte', waLink, message };
    } catch (err) {
      console.error('Fonnte error:', err.message);
    }
  }

  return {
    success: false,
    reason: 'WhatsApp belum tersambung via Baileys/Fonnte, tapi direct link tersedia',
    waLink,
    message
  };
}

/**
 * Send WhatsApp thank-you & voucher delivery automatically via Baileys (primary) or Fonnte (fallback)
 */
async function sendWhatsAppNotification({ phone, orderId, buyerName, amount, voucherUrl, historyUrl, storeName = 'mybrotools' }) {
  const formattedPhone = formatWhatsAppNumber(phone);
  if (!formattedPhone) return { success: false, reason: 'No phone number' };

  const message = buildThankYouMessage({
    orderId,
    buyerName,
    amount,
    voucherUrl,
    historyUrl,
    storeName
  });

  const waLink = generateWaLink({ phone: formattedPhone, message });

  // 1. Try Baileys (Self-Hosted WhatsApp)
  if (baileys.status === 'CONNECTED') {
    const bResult = await baileys.sendMessage(formattedPhone, message);
    if (bResult.success) {
      return { success: true, provider: 'baileys', waLink, message };
    }
  }

  // 2. Fallback to Fonnte if token is set
  const fonnteToken = process.env.FONNTE_TOKEN;
  if (fonnteToken) {
    try {
      console.log(`[WhatsApp] Mengirim via Fonnte ke ${formattedPhone}...`);
      await axios.post(
        'https://api.fonnte.com/send',
        {
          target: formattedPhone,
          message: message,
          countryCode: '62'
        },
        {
          headers: { Authorization: fonnteToken },
          timeout: 10000
        }
      );
      return { success: true, provider: 'fonnte', waLink, message };
    } catch (err) {
      console.error('Fonnte error:', err.message);
    }
  }

  return {
    success: false,
    reason: 'WhatsApp belum tersambung via Baileys/Fonnte, tapi direct link tersedia',
    waLink,
    message
  };
}

module.exports = {
  formatWhatsAppNumber,
  buildPaymentInstructionMessage,
  buildThankYouMessage,
  generateWaLink,
  sendPaymentInstructionNotification,
  sendWhatsAppNotification
};
