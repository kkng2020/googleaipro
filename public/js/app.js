let currentOrder = null;
let pollInterval = null;
let countdownInterval = null;

function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

function formatDateTime(dateStr) {
  const date = dateStr ? new Date(dateStr) : new Date();
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${d}/${m}/${y} ${h}:${min}:${s}`;
}

function showToast(msg) {
  const toast = document.getElementById('toastMsg');
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// -------------------------------------------------------------
// BuatQris Native Popup Modal Controls
// -------------------------------------------------------------
function openBuatQrisModal(paymentUrl) {
  if (!paymentUrl) return;
  const overlay = document.getElementById('bqModalOverlay');
  const iframe = document.getElementById('bqIframe');
  const loader = document.getElementById('bqIframeLoader');

  if (loader) loader.classList.remove('hide');
  iframe.src = paymentUrl;

  iframe.onload = () => {
    if (loader) loader.classList.add('hide');
  };

  overlay.style.display = 'flex';
}

function closeBuatQrisModal() {
  const overlay = document.getElementById('bqModalOverlay');
  if (overlay) overlay.style.display = 'none';
  const iframe = document.getElementById('bqIframe');
  if (iframe) iframe.src = '';
}

async function fetchStoreInfo() {
  try {
    const res = await fetch('/api/info');
    const data = await res.json();
    if (data.success && data.data) {
      const { price, stock, merchantName } = data.data;

      const priceFormatted = formatRupiah(price);
      document.getElementById('landingPrice').innerText = priceFormatted;
      document.getElementById('startBuyBtn').innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="21" r="1"></circle>
          <circle cx="20" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
        Beli Sekarang (${priceFormatted})
      `;

      document.getElementById('stockCountText').innerText = `Tersisa ${stock.available} dari ${stock.total}`;
      const percentage = (stock.available / stock.total) * 100;
      document.getElementById('stockBarFill').style.width = `${percentage}%`;

      if (stock.isSoldOut) {
        document.getElementById('startBuyBtn').disabled = true;
        document.getElementById('startBuyBtn').style.opacity = '0.5';
        document.getElementById('startBuyBtn').innerHTML = `
          <span>❌ Stok Habis Terjual</span>
        `;
      }
    }
  } catch (err) {
    console.error('Error fetching store info:', err);
  }
}

function parseBuatQrisDate(dateStr) {
  if (!dateStr) return Date.now() + 15 * 60 * 1000;
  if (typeof dateStr === 'number') return dateStr;

  const str = String(dateStr).trim();
  // If it's already an ISO string with Z or timezone offset
  if (str.includes('Z') || str.includes('+')) {
    const parsed = Date.parse(str);
    if (!isNaN(parsed)) return parsed;
  }

  // If format is "YYYY-MM-DD HH:mm:ss" or without offset (BuatQris is WIB, UTC+7)
  const clean = str.replace(' ', 'T');
  if (!clean.includes('+') && !clean.endsWith('Z')) {
    const parsedWib = Date.parse(clean + '+07:00');
    if (!isNaN(parsedWib)) return parsedWib;
  }

  const parsedGeneral = Date.parse(clean);
  return isNaN(parsedGeneral) ? Date.now() + 15 * 60 * 1000 : parsedGeneral;
}

function startCountdown(expiresAt) {
  if (countdownInterval) clearInterval(countdownInterval);

  const target = parseBuatQrisDate(expiresAt);
  const timerText = document.getElementById('timerText');
  const timerTextLarge = document.getElementById('timerTextLarge');

  function update() {
    const now = Date.now();
    const distance = target - now;

    if (distance <= 0) {
      clearInterval(countdownInterval);
      if (timerText) {
        timerText.innerText = '00 : 00';
        timerText.style.color = '#ef4444';
      }
      if (timerTextLarge) {
        timerTextLarge.innerText = '00 : 00';
        timerTextLarge.classList.add('warning');
      }
      const alertBox = document.getElementById('statusAlertBox');
      if (alertBox) {
        alertBox.className = 'status-alert-box';
        alertBox.style.background = '#fef2f2';
        alertBox.style.borderColor = '#fecaca';
        alertBox.style.color = '#dc2626';
      }
      const alertText = document.getElementById('statusAlertText');
      if (alertText) alertText.innerText = 'Waktu pembayaran telah habis. Silakan buat pesanan baru.';
      return;
    }

    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
    const formatted = `${String(minutes).padStart(2, '0')} : ${String(seconds).padStart(2, '0')}`;

    if (timerText) timerText.innerText = formatted;
    if (timerTextLarge) {
      timerTextLarge.innerText = formatted;
      if (distance < 120 * 1000) {
        timerTextLarge.classList.add('warning');
      } else {
        timerTextLarge.classList.remove('warning');
      }
    }
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

function renderOrderView(order) {
  currentOrder = order;

  document.getElementById('landingView').style.display = 'none';
  document.getElementById('checkoutView').style.display = 'grid';

  document.getElementById('merchantBadgeName').innerText = order.merchantName || 'mybrotools';
  document.getElementById('displayAmount').innerText = formatRupiah(order.amount);
  document.getElementById('displayOrderId').innerText = `Pesanan ${order.orderId || order.id}`;
  document.getElementById('rincianTotal').innerText = formatRupiah(order.total || order.amount);
  document.getElementById('rincianTxId').innerText = order.orderId || order.id;
  document.getElementById('rincianNominal').innerText = formatRupiah(order.amount);
  document.getElementById('rincianFee').innerText = `+ ${formatRupiah(order.fee || 0)}`;
  document.getElementById('rincianPhone').innerText = order.customerPhone || '-';
  document.getElementById('displayTime').innerText = formatDateTime(order.createdAt);

  const extTrxBtn = document.getElementById('openExternalTrxBtn');
  if (extTrxBtn && order.paymentUrl) {
    extTrxBtn.href = order.paymentUrl;
  }

  if (order.status === 'PAID') {
    closeBuatQrisModal();
    renderSuccessState(order);
  } else {
    document.getElementById('qrisBox').style.display = 'flex';
    document.getElementById('successBox').style.display = 'none';
    if (order.qrCodeUrl) {
      const qrisImg = document.getElementById('qrisImage');
      if (qrisImg) qrisImg.src = order.qrCodeUrl;
    }

    document.getElementById('statusAlertBox').className = 'status-alert-box pending';
    document.getElementById('statusAlertText').innerText = 'Menunggu pembayaran... Silakan bayar melalui popup BuatQris atau link WA.';

    startCountdown(order.expiresAt);
    startPolling(order.orderId || order.id);
  }
}

function renderSuccessState(order) {
  if (pollInterval) clearInterval(pollInterval);
  if (countdownInterval) clearInterval(countdownInterval);

  // Auto close BuatQris popup modal
  closeBuatQrisModal();

  const timerText = document.getElementById('timerText');
  if (timerText) {
    timerText.innerText = '-- : --';
    timerText.style.color = 'var(--text-main)';
  }
  const timerTextLarge = document.getElementById('timerTextLarge');
  if (timerTextLarge) {
    timerTextLarge.innerText = '-- : --';
    timerTextLarge.classList.remove('warning');
  }

  document.getElementById('qrisBox').style.display = 'none';
  const successBox = document.getElementById('successBox');
  successBox.style.display = 'flex';

  const claimBtn = document.getElementById('claimVoucherBtn');
  if (order.voucherUrl) {
    claimBtn.href = order.voucherUrl;
    claimBtn.onclick = null;
  }

  // Setup WhatsApp Receipt Link (if present in DOM)
  const waBtn = document.getElementById('waReceiptBtn');
  if (waBtn) {
    if (order.waLink) {
      waBtn.href = order.waLink;
      waBtn.style.display = 'flex';
    } else {
      const historyUrl = `${window.location.origin}/?order=${order.orderId || order.id}`;
      const defaultMsg = `Halo! Terima kasih telah membeli Voucher Google AI Pro 🎉\n\nNo. Pesanan: ${order.orderId || order.id}\nStatus: Lunas\nLink Klaim: ${order.voucherUrl}\nHistory: ${historyUrl}`;
      const cleanPhone = (order.customerPhone || '').replace(/[^0-9]/g, '');
      const intlPhone = cleanPhone.startsWith('0') ? '62' + cleanPhone.slice(1) : cleanPhone;
      waBtn.href = `https://wa.me/${intlPhone}?text=${encodeURIComponent(defaultMsg)}`;
      waBtn.style.display = 'flex';
    }
  }

  const copyBtn = document.getElementById('copyVoucherBtn');
  copyBtn.onclick = () => {
    if (order.voucherUrl) {
      navigator.clipboard.writeText(order.voucherUrl).then(() => {
        showToast('Link voucher berhasil disalin!');
      });
    }
  };

  const statusBox = document.getElementById('statusAlertBox');
  statusBox.className = 'status-alert-box success';
  statusBox.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <span>Pembayaran terverifikasi! Link voucher siap diklaim.</span>
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
          showToast('🎉 Pembayaran berhasil diverifikasi!');
          renderSuccessState(data.data);
        } else if (data.data.status === 'EXPIRED') {
          clearInterval(pollInterval);
          clearInterval(countdownInterval);
          closeBuatQrisModal();
          document.getElementById('statusAlertText').innerText = 'Waktu pembayaran telah habis.';
        }
      }
    } catch (e) {
      console.warn('Polling error:', e);
    }
  }, 2000);
}

async function handleCreateOrder() {
  const btn = document.getElementById('startBuyBtn');
  const buyerPhone = document.getElementById('buyerPhoneInput').value.trim();

  // Validate Phone
  if (!buyerPhone || buyerPhone.length < 9) {
    alert('Mohon masukkan nomor WhatsApp yang aktif (minimal 9 digit, contoh: 08123456789) agar link pembayaran dan voucher dapat dikirimkan ke Anda.');
    document.getElementById('buyerPhoneInput').focus();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `
    <svg style="animation: spin 1s linear infinite;" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
    </svg>
    Menyiapkan Pembayaran BuatQris...
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

    // Open Original BuatQris Popup Modal
    if (data.data.paymentUrl) {
      openBuatQrisModal(data.data.paymentUrl);
      showToast('📩 Link pembayaran juga telah dikirim ke WhatsApp Anda!');
    }
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
      closeBuatQrisModal();
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
        closeBuatQrisModal();
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

  document.getElementById('startBuyBtn')?.addEventListener('click', handleCreateOrder);
  document.getElementById('simulatePayBtn')?.addEventListener('click', handleSimulatePay);
  document.getElementById('manualCheckBtn')?.addEventListener('click', handleManualCheck);
  document.getElementById('downloadStrukBtn')?.addEventListener('click', handleDownloadStruk);
  document.getElementById('shareBtn')?.addEventListener('click', handleShare);

  // BuatQris Popup Close Button (Instant close without blocking confirm)
  document.getElementById('closeBqModalBtn')?.addEventListener('click', () => {
    closeBuatQrisModal();
  });

  // Close when clicking overlay backdrop outside modal
  document.getElementById('bqModalOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'bqModalOverlay') {
      closeBuatQrisModal();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeBuatQrisModal();
    }
  });

  // Reopen BuatQris Modal Button
  document.getElementById('reopenBqModalBtn')?.addEventListener('click', () => {
    if (currentOrder && currentOrder.paymentUrl) {
      openBuatQrisModal(currentOrder.paymentUrl);
    }
  });

  checkUrlParams();
});
