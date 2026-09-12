const BuatQrisPaymentProvider = require('./buatqris');
const DokuPaymentProvider = require('./doku');
const { SimulatorPaymentProvider } = require('./simulator');

function getPaymentProvider() {
  const providerType = (process.env.PAYMENT_PROVIDER || 'buatqris').toLowerCase();

  if (providerType === 'buatqris') {
    const bq = new BuatQrisPaymentProvider();
    if (bq.isConfigured()) {
      return bq;
    }
    console.warn('⚠️ PAYMENT_PROVIDER=buatqris, tetapi BQ_ACCOUNT_ID / BQ_SECRET_TOKEN belum lengkap. Menggunakan Simulator sementara.');
  }

  if (providerType === 'doku') {
    const doku = new DokuPaymentProvider();
    if (doku.isConfigured()) {
      return doku;
    }
    console.warn('⚠️ PAYMENT_PROVIDER=doku, tetapi DOKU credentials belum lengkap. Menggunakan Simulator sementara.');
  }

  return new SimulatorPaymentProvider();
}

module.exports = {
  getPaymentProvider
};
