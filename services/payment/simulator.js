const QRCode = require('qrcode');

function calculateCRC16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFFFF;
    }
  }
  let hex = crc.toString(16).toUpperCase();
  return hex.padStart(4, '0');
}

function tlv(tag, value) {
  const valStr = String(value);
  const len = String(valStr.length).padStart(2, '0');
  return `${tag}${len}${valStr}`;
}

function buildQrisPayload({ amount, orderId, merchantName = 'GOOGLE AI PRO' }) {
  const mai = tlv('00', 'ID.CO.QRIS.WWW') + tlv('01', 'ID1020021123456');
  const addData = tlv('01', orderId);

  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('01', '12'); // Dynamic
  payload += tlv('26', mai);
  payload += tlv('52', '5812');
  payload += tlv('53', '360');
  payload += tlv('54', String(amount));
  payload += tlv('58', 'ID');
  payload += tlv('59', merchantName.substring(0, 25).toUpperCase());
  payload += tlv('60', 'JAKARTA');
  payload += tlv('62', addData);
  payload += '6304';

  const checksum = calculateCRC16(payload);
  return payload + checksum;
}

class SimulatorPaymentProvider {
  constructor() {
    this.name = 'simulator';
  }

  async createPayment({ orderId, amount, merchantName }) {
    const rawQris = buildQrisPayload({ amount, orderId, merchantName });
    
    const qrCodeUrl = await QRCode.toDataURL(rawQris, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 400,
      color: {
        dark: '#1e1b4b',
        light: '#ffffff'
      }
    });

    return {
      success: true,
      provider: 'simulator',
      qrCodeData: rawQris,
      qrCodeUrl,
      amount,
      orderId
    };
  }

  async checkStatus(orderId) {
    return { success: true };
  }
}

module.exports = {
  SimulatorPaymentProvider,
  buildQrisPayload,
  calculateCRC16
};
