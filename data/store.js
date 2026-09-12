const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Default 10 Google AI Pro vouchers
const defaultState = () => {
  const defaultVouchers = [];
  for (let i = 1; i <= 10; i++) {
    defaultVouchers.push({
      id: `GAIP-VOUCHER-${String(i).padStart(2, '0')}`,
      url: `https://one.google.com/promo/ai-pro-sample-${i}`,
      status: 'AVAILABLE', // 'AVAILABLE' | 'LOCKED' | 'SOLD'
      lockedUntil: null,
      orderId: null,
      soldAt: null,
      buyerName: null,
      buyerPhone: null
    });
  }

  return {
    settings: {
      productName: 'Google AI Pro Voucher (Aktivasi Resmi)',
      price: 75000,
      fee: 0,
      currency: 'Rp',
      merchantName: 'mybrotools',
      orderTimeoutMinutes: 5,
      baseUrl: 'https://mybrotool.vercel.app'
    },
    vouchers: defaultVouchers,
    orders: []
  };
};

function ensureDirExists() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readData() {
  ensureDirExists();
  if (!fs.existsSync(DB_FILE)) {
    const initial = defaultState();
    writeData(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading db.json:', err);
    return defaultState();
  }
}

function writeData(data) {
  ensureDirExists();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  readData,
  writeData
};
