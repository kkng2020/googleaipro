/**
 * Automated QRIS Checkout & Voucher Delivery Application
 */

let currentOrder = null;
let pollInterval = null;
let countdownInterval = null;

function formatRupiah(number) {
  return 'Rp ' + Number(number).toLocaleString('id-ID');
}

function showToast(message) {
  const toast = document.getElementById('toastMsg');
  toast.innerText = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

function formatDateTime(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const d = date.getDate();
  const m = months[date.getMonth()];
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${d} ${m} ${y}, ${hh}.${mm}`;
}

async function fetchStoreInfo() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    if (data.success) {
      const info = data.data;
      document.getElementById('productTitle').innerText = info.productName;
      document.getElementById('landingPrice').innerText = formatRupiah(info.price);
      document.getElementById('stockCountText').innerText = `Tersisa ${info.stock.available} dari ${info.stock.total}`;
      
      const percent = (info.stock.available / info.stock.total) * 100;
      document.getElementById('stockBarFill').style.width = `${percent}%`;

      const startBuyBtn = document.getElementById('startBuyBtn');
      if (info.stock.isSoldOut) {
        startBuyBtn.disabled = true;
        startBuyBtn.style.opacity = '0.5';
        startBuyBtn.style.cursor = 'not-allowed';
        startBuyBtn.innerText = 'Maaf, Stok Habis Terjual';
      } else {
        startBuyBtn.innerHTML = `
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
          </svg>
          Beli Sekarang (${formatRupiah(info.price)})
        `;
      }
    }
  } catch (err) {
    console.error('Error fetching store info:', err);
  }
}

function startCountdown(expiresAt) {
  if (countdownInterval) clearInterval(countdownInterval);

  const target = new Date(expiresAt).getTime();
  const timerText = document.getElementById('timerText');

  function update() {
    const now = Date.now();
    const distance = target - now;

    if (distance <= 0) {
      clearInterval(countdownInterval);
      timerText.innerText = '00 : 00';
      timerText.style.color = '#ef4444';
      document.getElementById('statusAlertBox').className = 'status-alert-box';
      document.getElementById('statusAlertBox').style.background = '#fef2f2';
      document.getElementById('statusAlertBox').style.borderColor = '#fecaca';
      document.getElementById('statusAlertBox').style.color = '#dc2626';
      document.getElementById('statusAlertText').innerText = 'Waktu pembayaran telah habis. Silakan buat pesanan baru.';
      return;
    }

    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
    timerText.innerText = `${String(minutes).padStart(2, '0')} : ${String(seconds).padStart(2, '0')}`;
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

function renderOrderView(order) {
  currentOrder = order;

  document.getElementById('landingView').style.display = 'none';
  document.getElementById('checkoutView').style.display = 'grid';

  document.getElementById('merchantBadgeName').innerText = order.merchantName || 'Google AI Store';
  document.getElementById('displayAmount').innerText = formatRupiah(order.amount);
  document.getElementById('displayOrderId').innerText = `Pesanan ${order.orderId || order.id}`;
  document.getElementById('rincianTotal').innerText = formatRupiah(order.total || order.amount);
  document.getElementById('rincianTxId').innerText = order.orderId || order.id;
  document.getElementById('rincianNominal').innerText = formatRupiah(order.amount);
  document.getElementById('rincianFee').innerText = `+ ${formatRupiah(order.fee || 0)}`;
  document.getElementById('rincianPhone').innerText = order.customerPhone || '-';
  document.getElementById('displayTime').innerText = formatDateTime(order.createdAt);

  if (order.status === 'PAID') {
    renderSuccessState(order);
  } else {
    document.getElementById('qrisBox').style.display = 'flex';
    document.getElementById('successBox').style.display = 'none';
    document.getElementById('qrisImage').src = order.qrCodeUrl;

    document.getElementById('statusAlertBox').className = 'status-alert-box pending';
    document.getElementById('statusAlertText').innerText = 'Menunggu pembayaran... Silakan scan QRIS di samping.';

    startCountdown(order.expiresAt);
    startPolling(order.orderId || order.id);
  }
}

function renderSuccessState(order) {
  if (pollInterval) clearInterval(pollInterval);
  if (countdownInterval) clearInterval(countdownInterval);

  const timerText = document.getElementById('timerText');
  timerText.innerText = '-- : --';
  timerText.style.color = 'var(--text-main)';

  document.getElementById('qrisBox').style.display = 'none';
  const successBox = document.getElementById('successBox');
  successBox.style.display = 'flex';

  const claimBtn = document.getElementById('claimVoucherBtn');
  if (order.voucherUrl) {
    claimBtn.href = order.voucherUrl;
    claimBtn.onclick = null;
  }

  // Setup WhatsApp Receipt Link
  const waBtn = document.getElementById('waReceiptBtn');
  if (order.waLink) {
    waBtn.href = order.waLink;
    waBtn.style.display = 'flex';
  } else {
    // If waLink wasn't provided yet, build on the fly
    const historyUrl = `${window.location.origin}/?order=${order.orderId || order.id}`;
    const defaultMsg = `Halo! Terima kasih telah membeli Voucher Google AI Pro 🎉\n\nNo. Pesanan: ${order.orderId || order.id}\nStatus: Lunas\nLink Klaim: ${order.voucherUrl}\nHistory: ${historyUrl}`;
    const cleanPhone = (order.customerPhone || '').replace(/[^0-9]/g, '');
    const intlPhone = cleanPhone.startsWith('0') ? '62' + cleanPhone.slice(1) : cleanPhone;
    waBtn.href = `https://wa.me/${intlPhone}?text=${encodeURIComponent(defaultMsg)}`;
    waBtn.style.display = 'flex';
  }

  const copyBtn = document.getElementById('copyVoucherBtn');
  copyBtn.onclick = () => {
    if (order.voucherUrl) {
      navigator.clipboard.writeText(order.voucherUrl).then(() => {
        showToast('Link klaim voucher berhasil disalin!');
      });
    }
  };

  const statusBox = document.getElementById('statusAlertBox');
  statusBox.className = 'status-alert-box success';
  statusBox.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>Pembayaran telah berhasil!</span>
  `;
}

function startPolling(orderId) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/order/${orderId}`);
      const data = await res.json();
      if (data.success && data.data) {
        if (data.data.status === 'PAID') {
          renderSuccessState(data.data);
        } else if (data.data.status === 'EXPIRED') {
          clearInterval(pollInterval);
          clearInterval(countdownInterval);
          document.getElementById('statusAlertText').innerText = 'Waktu pembayaran telah habis.';
        }
      }
    } catch (e) {
      console.warn('Polling error:', e);
    }
  }, 2500);
}

async function handleCreateOrder() {
  const btn = document.getElementById('startBuyBtn');
  const buyerPhone = document.getElementById('buyerPhoneInput').value.trim();

  // Validate Phone
  if (!buyerPhone || buyerPhone.length < 9) {
    alert('Mohon masukkan nomor WhatsApp yang aktif (minimal 9 digit, contoh: 08123456789) agar link voucher dan struk pembelian dapat dikirimkan ke Anda.');
    document.getElementById('buyerPhoneInput').focus();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `
    <svg style="animation: spin 1s linear infinite;" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
    </svg>
    Menyiapkan QRIS Dinamis...
  `;

  try {
    const res = await fetch('/api/order/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Pelanggan ' + buyerPhone.slice(-4),
        customerPhone: buyerPhone
      })
    });

    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Gagal membuat pesanan');
      btn.disabled = false;
      btn.innerText = 'Beli Sekarang (Rp 75.000)';
      return;
    }

    const url = new URL(window.location);
    url.searchParams.set('order', data.data.orderId);
    window.history.pushState({}, '', url);

    renderOrderView(data.data);
  } catch (err) {
    console.error('Create order error:', err);
    alert('Terjadi kesalahan saat membuat pesanan. Silakan coba lagi.');
    btn.disabled = false;
    btn.innerText = 'Beli Sekarang (Rp 75.000)';
  }
}

async function handleSimulatePay() {
  if (!currentOrder) return;
  const orderId = currentOrder.orderId || currentOrder.id;
  const btn = document.getElementById('simulatePayBtn');
  btn.innerText = 'Memproses Simulasi...';

  try {
    const res = await fetch(`/api/order/${orderId}/simulate-pay`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      showToast('Pembayaran berhasil diverifikasi!');
      renderSuccessState({
        ...currentOrder,
        status: 'PAID',
        voucherUrl: data.data.voucherUrl,
        waLink: data.data.waLink
      });
    } else {
      alert(data.error || 'Gagal simulasi');
    }
  } catch (err) {
    console.error('Simulate pay error:', err);
  } finally {
    btn.innerHTML = '⚡ <span>Simulasikan Bayar Berhasil (Tes)</span>';
  }
}

async function handleManualCheck() {
  if (!currentOrder) return;
  const orderId = currentOrder.orderId || currentOrder.id;
  const btn = document.getElementById('manualCheckBtn');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = 'Memeriksa status...';

  try {
    const res = await fetch(`/api/order/${orderId}`);
    const data = await res.json();
    if (data.success && data.data) {
      if (data.data.status === 'PAID') {
        showToast('Pembayaran sudah lunas!');
        renderSuccessState(data.data);
      } else {
        showToast('Menunggu dana masuk dari aplikasi bank/e-wallet Anda...');
      }
    }
  } catch (e) {
    showToast('Gagal memeriksa status');
  } finally {
    btn.innerHTML = originalHtml;
  }
}

function handleDownloadStruk() {
  const receiptArea = document.getElementById('receiptPrintArea');
  showToast('Menyiapkan download struk...');

  if (window.html2canvas) {
    html2canvas(receiptArea, {
      scale: 2,
      backgroundColor: document.body.getAttribute('data-theme') === 'dark' ? '#111827' : '#ffffff'
    }).then(canvas => {
      const link = document.createElement('a');
      link.download = `Struk-${currentOrder?.orderId || currentOrder?.id || 'Pesanan'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('Struk berhasil didownload!');
    }).catch(err => {
      console.error(err);
      window.print();
    });
  } else {
    window.print();
  }
}

function handleShare() {
  const shareData = {
    title: 'Voucher Google AI Pro Resmi',
    text: 'Beli Voucher Google AI Pro Resmi Rp 75.000 dengan aktivasi otomatis via QRIS!',
    url: window.location.href
  };

  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
  } else {
    navigator.clipboard.writeText(window.location.href).then(() => {
      showToast('Tautan berhasil disalin ke clipboard!');
    });
  }
}

function setupThemeToggle() {
  const toggleBtn = document.getElementById('themeToggle');
  const saved = localStorage.getItem('site-theme') || 'light';
  document.body.setAttribute('data-theme', saved);

  toggleBtn.addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', current);
    localStorage.setItem('site-theme', current);
  });
}

async function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order');

  if (orderId) {
    try {
      const res = await fetch(`/api/order/${orderId}`);
      const data = await res.json();
      if (data.success && data.data) {
        renderOrderView(data.data);
        return;
      }
    } catch (e) {
      console.warn('Cannot load order from param:', e);
    }
  }

  fetchStoreInfo();
}

document.addEventListener('DOMContentLoaded', () => {
  setupThemeToggle();

  document.getElementById('startBuyBtn').addEventListener('click', handleCreateOrder);
  document.getElementById('simulatePayBtn').addEventListener('click', handleSimulatePay);
  document.getElementById('manualCheckBtn').addEventListener('click', handleManualCheck);
  document.getElementById('downloadStrukBtn').addEventListener('click', handleDownloadStruk);
  document.getElementById('shareBtn').addEventListener('click', handleShare);

  checkUrlParams();
});
