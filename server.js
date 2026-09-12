require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const StockManager = require('./services/stockManager');
const { getPaymentProvider } = require('./services/payment');
const { readData } = require('./data/store');
const {
  sendWhatsAppNotification,
  sendPaymentInstructionNotification,
  generateWaLink,
  buildThankYouMessage
} = require('./services/whatsapp');
const baileys = require('./services/baileys');

// Initialize Baileys WhatsApp Connection only if not running on Vercel Serverless
if (!process.env.VERCEL) {
  baileys.init();
}

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'adminmybro123';
const orderLastCheckMap = new Map();

// Capture raw body for webhook HMAC signature verification
app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Helper Order ID
function generateOrderId() {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `GAIP-${yy}${mm}${dd}-${rand}`;
}

// -------------------------------------------------------------
// Admin Security & Auth Middleware
// -------------------------------------------------------------
function generateAdminToken() {
  return crypto
    .createHmac('sha256', ADMIN_PASSWORD)
    .update('mybrotools-admin-secret-salt')
    .digest('hex');
}

function requireAdminAuth(req, res, next) {
  const token =
    req.headers['x-admin-token'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

  const expectedToken = generateAdminToken();

  if (token && token === expectedToken) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Akses ditolak: Autentikasi Admin diperlukan'
  });
}

// -------------------------------------------------------------
// Public Endpoints
// -------------------------------------------------------------

app.get('/api/info', async (req, res) => {
  try {
    const stockInfo = await StockManager.getStock();
    res.json({
      success: true,
      data: {
        productName: stockInfo.settings.productName,
        price: stockInfo.settings.price,
        fee: stockInfo.settings.fee,
        merchantName: stockInfo.settings.merchantName,
        stock: {
          available: stockInfo.available,
          total: stockInfo.total,
          isSoldOut: stockInfo.available === 0
        },
        timeoutMinutes: stockInfo.settings.orderTimeoutMinutes
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/order/create', async (req, res) => {
  try {
    const stockInfo = await StockManager.getStock();
    if (stockInfo.available <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Maaf, semua voucher Google AI Pro saat ini sudah habis terjual!'
      });
    }

    const { customerName, customerPhone } = req.body;
    if (!customerPhone || customerPhone.trim().length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Nomor WhatsApp wajib diisi agar link voucher & riwayat pesanan dapat dikirimkan ke Anda!'
      });
    }

    const orderId = generateOrderId();
    const amount = stockInfo.settings.price;
    const fee = stockInfo.settings.fee || 0;
    const total = amount + fee;

    const provider = getPaymentProvider();
    const paymentResult = await provider.createPayment({
      orderId,
      amount: total,
      merchantName: stockInfo.settings.merchantName,
      customerName: customerName || 'Pembeli',
      customerPhone: customerPhone.trim(),
      description: `Google AI Pro - ${orderId}`
    });

    const order = await StockManager.createOrder({
      id: orderId,
      transactionId: paymentResult.transactionId || null,
      amount: paymentResult.totalAmount || total,
      customerName: customerName || 'Pembeli',
      customerPhone: customerPhone.trim(),
      qrCodeData: paymentResult.qrCodeData,
      qrCodeUrl: paymentResult.qrCodeUrl,
      paymentUrl: paymentResult.paymentUrl || null,
      expiresAt: paymentResult.expiredAt || null,
      provider: provider.name
    });

    // Send Payment Link to Customer WhatsApp simultaneously
    if (paymentResult.paymentUrl) {
      sendPaymentInstructionNotification({
        phone: order.customerPhone,
        orderId: order.id,
        buyerName: order.customerName,
        total: order.amount,
        paymentUrl: paymentResult.paymentUrl,
        storeName: stockInfo.settings.merchantName || 'mybrotools'
      }).catch(err => console.error('WA payment link dispatch error:', err.message));
    }

    res.json({
      success: true,
      data: {
        orderId: order.id,
        transactionId: order.transactionId,
        amount: order.amount,
        fee,
        total: order.amount,
        qrCodeUrl: order.qrCodeUrl,
        qrCodeData: order.qrCodeData,
        paymentUrl: paymentResult.paymentUrl || null,
        expiresAt: order.expiresAt,
        status: order.status,
        provider: order.provider,
        merchantName: stockInfo.settings.merchantName,
        customerPhone: order.customerPhone
      }
    });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/order/:id', async (req, res) => {
  try {
    const order = await StockManager.getOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan' });
    }

    // Fallback Active status check with BuatQris (15s throttle per order)
    if (order.status === 'PENDING' && order.provider === 'buatqris' && order.transactionId) {
      const now = Date.now();
      const lastCheck = orderLastCheckMap.get(order.id) || 0;
      if (now - lastCheck > 15000) {
        orderLastCheckMap.set(order.id, now);
        const provider = getPaymentProvider();
        if (provider.name === 'buatqris' && provider.checkStatus) {
          try {
            const bqStatus = await provider.checkStatus(order.transactionId);
            if (bqStatus && bqStatus.status === 'success') {
              console.log(`✅ Order ${order.id} detected as PAID via BuatQris status check!`);
              const markResult = await StockManager.markAsPaid(order.id, {
                provider: 'buatqris',
                statusCheck: bqStatus,
                paidAt: bqStatus.updated_at || new Date().toISOString()
              });
              order.status = 'PAID';
              order.voucherUrl = markResult.voucherUrl;
              order.isPaid = true;

              const historyUrl = `${BASE_URL}/?order=${order.id}`;
              sendWhatsAppNotification({
                phone: order.customerPhone,
                orderId: order.id,
                buyerName: order.customerName,
                amount: order.amount,
                voucherUrl: markResult.voucherUrl,
                historyUrl,
                storeName: 'mybrotools'
              }).catch(e => console.error('WA notify error:', e.message));
            }
          } catch (chkErr) {
            console.warn('BuatQris status check error:', chkErr.message);
          }
        }
      }
    }

    let waLink = null;
    let waMessage = null;

    if (order.status === 'PAID' && order.voucherUrl) {
      const historyUrl = `${BASE_URL}/?order=${order.id}`;
      waMessage = buildThankYouMessage({
        orderId: order.id,
        buyerName: order.customerName,
        amount: order.amount,
        voucherUrl: order.voucherUrl,
        historyUrl,
        storeName: 'mybrotools'
      });

      waLink = generateWaLink({
        phone: order.customerPhone,
        message: waMessage
      });
    }

    res.json({
      success: true,
      data: {
        ...order,
        waLink,
        waMessage
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/order/:id/simulate-pay', async (req, res) => {
  try {
    const orderId = req.params.id;
    const result = await StockManager.markAsPaid(orderId, {
      method: 'SIMULATOR_TEST',
      paidAt: new Date().toISOString()
    });

    const historyUrl = `${BASE_URL}/?order=${orderId}`;
    const waResult = await sendWhatsAppNotification({
      phone: result.order.customerPhone,
      orderId,
      buyerName: result.order.customerName,
      amount: result.order.amount,
      voucherUrl: result.voucherUrl,
      historyUrl,
      storeName: 'mybrotools'
    });

    res.json({
      success: true,
      message: 'Pembayaran berhasil diverifikasi!',
      data: {
        orderId: result.order.id,
        status: result.order.status,
        voucherUrl: result.voucherUrl,
        waLink: waResult.waLink || generateWaLink({ phone: result.order.customerPhone, message: waResult.message }),
        waMessage: waResult.message
      }
    });
  } catch (error) {
    console.error('Simulation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// BuatQris Webhook Endpoint
// -------------------------------------------------------------
app.post('/api/webhook/buatqris', async (req, res) => {
  try {
    console.log('--- BuatQris Webhook Received ---', req.body);
    const signature = req.get('X-BuatQris-Signature') || '';
    const event = req.get('X-BuatQris-Event') || req.body?.event;
    const delivery = req.get('X-BuatQris-Delivery') || req.body?.transaction_id;

    const provider = getPaymentProvider();
    if (provider.name === 'buatqris' && provider.verifyWebhookSignature) {
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
      const isValid = provider.verifyWebhookSignature(signature, rawBody);
      if (!isValid && process.env.NODE_ENV === 'production') {
        console.warn('⚠️ Webhook signature mismatch!');
        return res.status(401).send('Unauthorized signature');
      }
    }

    if (event === 'payment.success') {
      const trxId = req.body?.transaction_id || delivery;
      console.log(`✅ BuatQris payment.success received for transaction: ${trxId}`);

      const result = await StockManager.markAsPaid(trxId, {
        provider: 'buatqris',
        rawWebhook: req.body,
        paidAt: req.body?.paid_at || new Date().toISOString()
      });

      console.log(`✅ Order ${result.order.id} marked as PAID! Voucher assigned.`);

      // Trigger automatic WhatsApp notification to buyer
      const historyUrl = `${BASE_URL}/?order=${result.order.id}`;
      await sendWhatsAppNotification({
        phone: result.order.customerPhone,
        orderId: result.order.id,
        buyerName: result.order.customerName,
        amount: result.order.amount,
        voucherUrl: result.voucherUrl,
        historyUrl,
        storeName: 'mybrotools'
      });
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('BuatQris webhook error:', error);
    res.status(200).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// DOKU Webhook (Preserved)
// -------------------------------------------------------------
app.post('/api/webhook/doku', async (req, res) => {
  try {
    console.log('--- DOKU Webhook Notification Received ---');
    const invoiceNumber = req.body?.order?.invoice_number;
    const transactionStatus = req.body?.transaction?.status;

    if (!invoiceNumber) {
      return res.status(400).send('Bad Request: Missing invoice_number');
    }

    if (transactionStatus === 'SUCCESS') {
      const result = await StockManager.markAsPaid(invoiceNumber, {
        provider: 'doku',
        rawWebhook: req.body
      });
      console.log(`✅ Order ${invoiceNumber} marked as PAID via DOKU webhook!`);

      const historyUrl = `${BASE_URL}/?order=${invoiceNumber}`;
      await sendWhatsAppNotification({
        phone: result.order.customerPhone,
        orderId: invoiceNumber,
        buyerName: result.order.customerName,
        amount: result.order.amount,
        voucherUrl: result.voucherUrl,
        historyUrl,
        storeName: 'mybrotools'
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('DOKU Webhook error:', error);
    res.status(500).send('Internal Error');
  }
});

// -------------------------------------------------------------
// Admin Endpoints (Protected by Authentication)
// -------------------------------------------------------------

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      error: 'Password Admin salah. Silakan coba lagi!'
    });
  }

  const token = generateAdminToken();
  res.json({
    success: true,
    token,
    message: 'Login berhasil!'
  });
});

app.get('/api/admin/verify', requireAdminAuth, (req, res) => {
  res.json({ success: true, authenticated: true });
});

app.get('/api/admin/data', requireAdminAuth, async (req, res) => {
  try {
    const vouchers = await StockManager.getAllVouchers();
    const stats = await StockManager.getStock();
    const localData = readData();

    res.json({
      success: true,
      data: {
        vouchers,
        orders: localData.orders,
        settings: localData.settings,
        stats
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/vouchers', requireAdminAuth, async (req, res) => {
  try {
    const { vouchers } = req.body;
    if (!Array.isArray(vouchers)) {
      return res.status(400).json({ success: false, error: 'vouchers must be an array' });
    }
    const updated = await StockManager.updateVouchers(vouchers);
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/reset', requireAdminAuth, async (req, res) => {
  try {
    const reset = await StockManager.resetAllVouchersToAvailable();
    res.json({
      success: true,
      message: 'Semua voucher berhasil direset ke status AVAILABLE',
      data: reset
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/whatsapp/status', requireAdminAuth, (req, res) => {
  res.json({ success: true, data: baileys.getStatus() });
});

app.post('/api/admin/whatsapp/logout', requireAdminAuth, async (req, res) => {
  const result = await baileys.logout();
  res.json({ success: true, data: result });
});

// Universal fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Only start server when not loaded as a module (e.g. for Vercel serverless)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Server Berjalan di: http://localhost:${PORT}`);
    console.log(`📦 Halaman Checkout:   http://localhost:${PORT}`);
    console.log(`⚙️  Admin Dashboard:   http://localhost:${PORT}/admin/index.html`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
