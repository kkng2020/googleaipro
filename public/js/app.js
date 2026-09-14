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

      const stockEl = document.getElementById('stockCountText');
      stockEl.innerText = `Stock ${stock.available} Voucher`;
      stockEl.style.display = 'inline';
      const percentage = (stock.available / stock.total) * 100;
      document.getElementById('stockBarFill').style.width = `${percentage}%`;

      const unitEl = document.getElementById('confirmUnitPrice');
      if (unitEl) unitEl.innerText = priceFormatted;
      const totalEl = document.getElementById('confirmTotalPrice');
      if (totalEl) totalEl.innerText = priceFormatted;
      const payBtnText = document.getElementById('confirmPayBtnText');
      if (payBtnText) payBtnText.innerText = `Bayar Sekarang (${priceFormatted})`;

      if (stock.isSoldOut) {
        document.getElementById('startBuyBtn').disabled = true;
        document.getElementById('startBuyBtn').style.opacity = '0.5';
        document.getElementById('startBuyBtn').innerHTML = `
          <span>❌ Stok Habis Terjual</span>
        `;
        const confirmPayBtn = document.getElementById('confirmPayBtn');
        if (confirmPayBtn) {
          confirmPayBtn.disabled = true;
          confirmPayBtn.style.opacity = '0.5';
          confirmPayBtn.innerHTML = `<span>❌ Stok Habis Terjual</span>`;
        }
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
  return isNaN(parsedGeneral) ? Date.now() + 5 * 60 * 1000 : parsedGeneral;
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
        timerText.style.color = '#eab308';
      }
      if (timerTextLarge) {
        timerTextLarge.innerText = '00 : 00';
        timerTextLarge.classList.add('warning');
      }
      const alertBox = document.getElementById('statusAlertBox');
      if (alertBox) {
        alertBox.className = 'status-alert-box pending';
        alertBox.style.background = 'rgba(234, 179, 8, 0.1)';
        alertBox.style.borderColor = 'rgba(234, 179, 8, 0.3)';
        alertBox.style.color = '#eab308';
      }
      const alertText = document.getElementById('statusAlertText');
      if (alertText) alertText.innerText = 'Batas waktu pembayaran (5 menit) telah tercapai. Jika Anda baru saja transfer, sistem sedang memverifikasi pembayaran Anda.';

      closeBuatQrisModal();
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
  const confirmView = document.getElementById('confirmView');
  if (confirmView) confirmView.style.display = 'none';
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
  } else if (order.status === 'EXPIRED') {
    renderExpiredState(order);
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

function renderExpiredState(order) {
  if (pollInterval) clearInterval(pollInterval);
  if (countdownInterval) clearInterval(countdownInterval);

  closeBuatQrisModal();

  const timerText = document.getElementById('timerText');
  if (timerText) {
    timerText.innerText = '00 : 00';
    timerText.style.color = '#ef4444';
  }
  const timerTextLarge = document.getElementById('timerTextLarge');
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
  if (alertText) alertText.innerText = 'Waktu pembayaran (5 menit) telah habis. Voucher telah dibuka kembali. Silakan buat pesanan baru.';

  const reopenBtn = document.getElementById('reopenBqModalBtn');
  if (reopenBtn) {
    reopenBtn.innerHTML = '<span>🔄 Buat Pesanan Baru</span>';
    reopenBtn.onclick = () => { window.location.href = '/'; };
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
          renderExpiredState(data.data);
        }
      }
    } catch (e) {
      console.warn('Polling error:', e);
    }
  }, 2000);
}

function handleProceedToConfirmation() {
  const buyerPhone = document.getElementById('buyerPhoneInput').value.trim();

  // Validate Phone
  if (!buyerPhone || buyerPhone.length < 9) {
    alert('Mohon masukkan nomor WhatsApp yang aktif (minimal 9 digit, contoh: 08123456789) agar link pembayaran dan voucher dapat dikirimkan ke Anda.');
    document.getElementById('buyerPhoneInput').focus();
    return;
  }

  const confirmPhoneVal = document.getElementById('confirmPhoneVal');
  if (confirmPhoneVal) confirmPhoneVal.innerText = buyerPhone;

  document.getElementById('landingView').style.display = 'none';
  const confirmView = document.getElementById('confirmView');
  if (confirmView) confirmView.style.display = 'grid';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleBackToLanding() {
  const confirmView = document.getElementById('confirmView');
  if (confirmView) confirmView.style.display = 'none';
  document.getElementById('landingView').style.display = 'block';
  document.getElementById('buyerPhoneInput').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleCreateOrder() {
  const btn = document.getElementById('confirmPayBtn') || document.getElementById('startBuyBtn');
  const buyerPhone = document.getElementById('buyerPhoneInput').value.trim();

  // Validate Phone
  if (!buyerPhone || buyerPhone.length < 9) {
    alert('Mohon masukkan nomor WhatsApp yang aktif (minimal 9 digit, contoh: 08123456789) agar link pembayaran dan voucher dapat dikirimkan ke Anda.');
    handleBackToLanding();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `
    <svg style="animation: spin 1s linear infinite;" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
    </svg>
    <span>Menyiapkan Pembayaran QRIS...</span>
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
      const priceText = document.getElementById('confirmTotalPrice')?.innerText || 'Rp 75.000';
      btn.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
          <line x1="1" y1="10" x2="23" y2="10"></line>
        </svg>
        <span id="confirmPayBtnText">Bayar Sekarang (${priceText})</span>
      `;
      return;
    }

    const url = new URL(window.location);
    url.searchParams.set('order', data.data.orderId);
    window.history.pushState({}, '', url);

    const confirmView = document.getElementById('confirmView');
    if (confirmView) confirmView.style.display = 'none';

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
    const priceText = document.getElementById('confirmTotalPrice')?.innerText || 'Rp 75.000';
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
        <line x1="1" y1="10" x2="23" y2="10"></line>
      </svg>
      <span id="confirmPayBtnText">Bayar Sekarang (${priceText})</span>
    `;
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

  document.getElementById('startBuyBtn')?.addEventListener('click', handleProceedToConfirmation);
  document.getElementById('confirmBackBtn')?.addEventListener('click', handleBackToLanding);
  document.getElementById('confirmEditPhoneBtn')?.addEventListener('click', handleBackToLanding);
  document.getElementById('confirmPayBtn')?.addEventListener('click', handleCreateOrder);
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
