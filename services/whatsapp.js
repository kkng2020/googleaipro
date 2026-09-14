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

function getPublicBaseUrl() {
  if (process.env.BASE_URL && !process.env.BASE_URL.includes('localhost')) {
    return process.env.BASE_URL.replace(/\/+$/, '');
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(/\/+$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/+$/, '');
  }
  return 'https://mybrotool.vercel.app';
}

function buildPaymentInstructionMessage({ orderId, buyerName, total, paymentUrl, orderWebUrl, storeName = 'mybrotools' }) {
  let webUrl = orderWebUrl;
  if (!webUrl || webUrl.includes('localhost')) {
    webUrl = `${getPublicBaseUrl()}/?order=${orderId}`;
  }
  return `Halo Kak ${buyerName || 'Pelanggan'}! 👋

Terima kasih telah memesan *Voucher Google AI Pro* di *${storeName}* ✨

Berikut adalah link pesanan & pembayaran resmi Anda:

📋 *RINCIAN PESANAN:*
• No. Pesanan   : ${orderId}
• Total Tagihan : Rp ${Number(total).toLocaleString('id-ID')}
• Batas Waktu   : 5 Menit ⏳
• Status        : MENUNGGU PEMBAYARAN ⏳

🌐 *LINK HALAMAN PESANAN & VOUCHER ANDA:*
${webUrl}

🔗 *LINK PEMBAYARAN QRIS (BuatQris):*
${paymentUrl}

💡 *PANDUAN:*
1. Selesaikan pembayaran dalam waktu *5 menit* melalui link QRIS di atas atau scan QRIS yang tampil di layar.
2. Link halaman pesanan Anda (${webUrl}) akan *otomatis berubah menjadi halaman klaim voucher Google AI Pro* begitu pembayaran Anda terverifikasi lunas!
3. Jika melebihi 5 menit, pesanan kedaluwarsa dan voucher akan dilepas kembali ke stok toko.

Jika butuh bantuan, silakan langsung balas pesan ini ya Kak. Terima kasih! 🙏`;
}

function buildThankYouMessage({ orderId, buyerName, amount, voucherUrl, historyUrl, storeName = 'mybrotools' }) {
  let histUrl = historyUrl;
  if (!histUrl || histUrl.includes('localhost')) {
    histUrl = `${getPublicBaseUrl()}/?order=${orderId}`;
  }
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
${histUrl}

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

function formatSlotId(id) {
  if (!id) return 'GAIP-VOUCHER-01';
  const s = String(id).trim();
  if (s.toUpperCase().startsWith('GAIP-VOUCHER-')) return s.toUpperCase();
  const num = s.replace(/[^0-9]/g, '');
  return num ? `GAIP-VOUCHER-${num.padStart(2, '0')}` : s;
}

function formatTransactionId(txId) {
  if (!txId) return '-';
  const s = String(txId).trim();
  return s.startsWith('#') ? s : `#${s}`;
}

function formatWIBTime(dateVal) {
  const date = dateVal ? new Date(dateVal) : new Date();
  return date.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\./g, ':') + ' WIB';
}

/**
 * Send WhatsApp notification to Admin/Owner whenever a purchase is completed
 */
async function sendAdminPurchaseNotification({
  buyerPhone,
  orderId,
  transactionId,
  slotId,
  paidAt,
  sisaVoucher,
  totalOmzet
}) {
  const adminPhone = process.env.ADMIN_WHATSAPP_PHONE || process.env.OWNER_WHATSAPP_PHONE || '081381290533';
  const formattedAdminPhone = formatWhatsAppNumber(adminPhone);
  if (!formattedAdminPhone) return { success: false, reason: 'No admin phone' };

  const formattedBuyerPhone = formatWhatsAppNumber(buyerPhone) || buyerPhone;
  const formattedSlot = formatSlotId(slotId);
  const formattedTrx = formatTransactionId(transactionId);
  const formattedTime = formatWIBTime(paidAt);
  const formattedOmzet = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(totalOmzet || 0);

  const message = `🔔 *PEMBELIAN BARU*
- Nomor HP Pembeli : ${formattedBuyerPhone}
- ORDER ID : ${orderId}
- TRANSACTION ID : ${formattedTrx}
- SLOT ID : ${formattedSlot}
- WAKTU PEMBELIAN : ${formattedTime}
- SISA VOUCHER : ${sisaVoucher != null ? sisaVoucher : 0} Voucher
- TOTAL OMZET : ${formattedOmzet}`;

  console.log(`[WhatsApp Admin] Menyiapkan notifikasi pembelian baru ke Owner (${formattedAdminPhone}):\n${message}`);

  // 1. Try Baileys (if connected)
  if (baileys.status === 'CONNECTED') {
    try {
      const bResult = await baileys.sendMessage(formattedAdminPhone, message);
      if (bResult.success) {
        console.log(`[WhatsApp Admin] Notifikasi sukses terkirim ke Owner via Baileys!`);
        return { success: true, provider: 'baileys', message };
      }
    } catch (bErr) {
      console.error('[WhatsApp Admin] Baileys error:', bErr.message);
    }
  }

  // 2. Try Fonnte (if token configured)
  const fonnteToken = process.env.FONNTE_TOKEN;
  if (fonnteToken) {
    try {
      await axios.post(
        'https://api.fonnte.com/send',
        {
          target: formattedAdminPhone,
          message: message,
          countryCode: '62'
        },
        {
          headers: { Authorization: fonnteToken },
          timeout: 10000
        }
      );
      console.log(`[WhatsApp Admin] Notifikasi sukses terkirim ke Owner via Fonnte!`);
      return { success: true, provider: 'fonnte', message };
    } catch (err) {
      console.error('[WhatsApp Admin] Fonnte error:', err.message);
    }
  }

  const waLink = generateWaLink({ phone: formattedAdminPhone, message });
  return {
    success: false,
    reason: 'WhatsApp belum tersambung via Baileys/Fonnte',
    waLink,
    message
  };
}

module.exports = {
  formatWhatsAppNumber,
  formatSlotId,
  formatTransactionId,
  formatWIBTime,
  buildPaymentInstructionMessage,
  buildThankYouMessage,
  generateWaLink,
  sendPaymentInstructionNotification,
  sendWhatsAppNotification,
  sendAdminPurchaseNotification
};
