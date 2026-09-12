const crypto = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');

class DokuPaymentProvider {
  constructor() {
    this.name = 'doku';
    this.clientId = process.env.DOKU_CLIENT_ID || '';
    this.secretKey = process.env.DOKU_SECRET_KEY || '';
    this.isProduction = process.env.DOKU_ENV === 'production';
    this.baseUrl = this.isProduction
      ? 'https://api.doku.com'
      : 'https://api-sandbox.doku.com';
  }

  isConfigured() {
    return Boolean(this.clientId && this.secretKey);
  }

  generateDigest(bodyString) {
    return crypto
      .createHash('sha256')
      .update(bodyString, 'utf8')
      .digest('base64');
  }

  generateSignature(clientId, requestId, timestamp, requestTarget, digest) {
    let componentSignature = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${requestTarget}`;
    if (digest) {
      componentSignature += `\nDigest:${digest}`;
    }

    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(componentSignature);
    const signature = hmac.digest('base64');
    return `HMACSHA256=${signature}`;
  }

  async createPayment({ orderId, amount, customerName = 'Pembeli', customerEmail = '' }) {
    if (!this.isConfigured()) {
      throw new Error('DOKU Client ID atau Secret Key belum diatur di file .env');
    }

    const requestTarget = '/qris-http/v1/generate-qr-code';
    const requestId = `REQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const payload = {
      order: {
        invoice_number: orderId,
        amount: Math.round(amount)
      },
      payment: {
        type: 'DYNAMIC'
      }
    };

    const bodyString = JSON.stringify(payload);
    const digest = this.generateDigest(bodyString);
    const signature = this.generateSignature(
      this.clientId,
      requestId,
      timestamp,
      requestTarget,
      digest
    );

    const headers = {
      'Client-Id': this.clientId,
      'Request-Id': requestId,
      'Request-Timestamp': timestamp,
      'Signature': signature,
      'Content-Type': 'application/json'
    };

    try {
      const response = await axios.post(`${this.baseUrl}${requestTarget}`, payload, {
        headers,
        timeout: 15000
      });

      const qrCodeData = response.data?.payment?.qr_code_data || response.data?.qr_code_data;
      if (!qrCodeData) {
        throw new Error('Gagal mendapatkan qr_code_data dari DOKU: ' + JSON.stringify(response.data));
      }

      const qrCodeUrl = await QRCode.toDataURL(qrCodeData, {
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
        provider: 'doku',
        qrCodeData,
        qrCodeUrl,
        amount,
        orderId,
        rawResponse: response.data
      };
    } catch (err) {
      console.error('DOKU Generate QRIS Error:', err.response?.data || err.message);
      const detail = err.response?.data?.error?.message || err.response?.data?.message || err.message;
      throw new Error(`DOKU API Error: ${detail}`);
    }
  }

  verifyWebhookSignature(headers, body) {
    if (!this.isConfigured()) return true;
    try {
      const clientId = headers['client-id'];
      const requestId = headers['request-id'];
      const timestamp = headers['request-timestamp'];
      const signature = headers['signature'];
      const requestTarget = headers['request-target'] || '/api/webhook/doku';

      const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
      const digest = this.generateDigest(bodyString);
      const expectedSignature = this.generateSignature(
        clientId,
        requestId,
        timestamp,
        requestTarget,
        digest
      );

      return signature === expectedSignature;
    } catch (e) {
      console.error('Signature verification error:', e);
      return false;
    }
  }
}

module.exports = DokuPaymentProvider;
