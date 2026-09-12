const crypto = require('crypto');
const axios = require('axios');

class BuatQrisPaymentProvider {
  constructor() {
    this.name = 'buatqris';
    this.accountId = process.env.BQ_ACCOUNT_ID || '';
    this.secretToken = process.env.BQ_SECRET_TOKEN || '';
    this.signingSecret = process.env.BQ_SIGNING_SECRET || '';
    this.baseUrl = process.env.BQ_BASE_URL || 'https://api.buatqris.site';
    this.appBaseUrl = process.env.BASE_URL || 'http://localhost:3000';
    this.testMode = process.env.BQ_TEST_MODE === '1';
  }

  isConfigured() {
    return Boolean(this.accountId && this.secretToken);
  }

  async createPayment({ orderId, amount, customerName = 'Pembeli', customerPhone = '', description = '' }) {
    if (!this.isConfigured()) {
      throw new Error('BQ_ACCOUNT_ID atau BQ_SECRET_TOKEN belum dikonfigurasi di file .env');
    }

    const callbackUrl = `${this.appBaseUrl.replace(/\/$/, '')}/api/webhook/buatqris`;
    const desc = (description || `Google AI Pro - ${orderId}`).slice(0, 100);

    const params = new URLSearchParams({
      action: 'api_create_qris',
      account_id: this.accountId,
      secret_token: this.secretToken,
      amount: String(Math.round(amount)),
      description: desc,
      qris_method: 'qris_two',
      fee_by: 'user',
      callback_url: callbackUrl
    });

    if (this.testMode) {
      params.append('test', '1');
    }

    try {
      const response = await axios.post(this.baseUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'mybrotools-bot/1.0'
        },
        timeout: 15000
      });

      const resData = response.data;
      if (!resData || !resData.success || !resData.data) {
        throw new Error(resData?.message || 'Gagal membuat QRIS BuatQris');
      }

      const qrisData = resData.data;
      const qrCodeUrl = qrisData.qr_url || qrisData.qris_image;

      return {
        success: true,
        provider: 'buatqris',
        transactionId: qrisData.transaction_id,
        orderId,
        amount: qrisData.amount,
        totalAmount: qrisData.total_amount,
        qrCodeUrl,
        qrCodeData: qrisData.qr_url,
        expiredAt: qrisData.expired_at,
        paymentUrl: qrisData.payment_url,
        rawResponse: resData
      };
    } catch (err) {
      console.error('BuatQris API Error:', err.response?.data || err.message);
      const msg = err.response?.data?.message || err.message;
      throw new Error(`BuatQris Error: ${msg}`);
    }
  }

  async checkStatus(transactionId) {
    if (!this.isConfigured() || !transactionId) {
      throw new Error('Kredensial atau transactionId tidak valid');
    }

    const params = new URLSearchParams({
      action: 'api_check_status',
      account_id: this.accountId,
      secret_token: this.secretToken,
      transaction_id: transactionId
    });

    try {
      const response = await axios.post(this.baseUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      });

      if (response.data && response.data.success) {
        return response.data.data;
      }
      return null;
    } catch (err) {
      console.error('Check status error:', err.response?.data || err.message);
      return null;
    }
  }

  verifyWebhookSignature(signature, rawBody) {
    if (!this.signingSecret) {
      console.warn('⚠️ BQ_SIGNING_SECRET belum diisi, signature verification dilewati');
      return true;
    }

    if (!signature) {
      return false;
    }

    try {
      const calculatedHex = crypto
        .createHmac('sha256', this.signingSecret)
        .update(rawBody)
        .digest('hex');

      const expected = `sha256=${calculatedHex}`;

      if (expected.length !== signature.length) {
        return false;
      }

      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch (e) {
      console.error('Signature verification error:', e);
      return false;
    }
  }
}

module.exports = BuatQrisPaymentProvider;
