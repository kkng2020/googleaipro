# Automated Google AI Pro Voucher Sales Bot with QRIS Payment

Sistem otomatisasi penjualan 10 Voucher Google AI Pro berbasis web link / bot. Pembeli cukup membuka link, menekan tombol **"Beli Sekarang"**, melakukan pembayaran melalui **QRIS dinamis Rp 75.000**, dan sistem akan secara otomatis memverifikasi pembayaran serta langsung menyerahkan tautan aktivasi voucher Google AI Pro tanpa perlu pengecekan manual.

---

## Rekomendasi Payment Gateway untuk Individu (Perorangan)

Untuk jualan perorangan (tanpa perlu PT/CV), ada beberapa pilihan terbaik di Indonesia:

| Payment Gateway | Status Kamu | Keunggulan | Biaya QRIS |
| :--- | :--- | :--- | :--- |
| **DOKU (Jokul)** | **Sudah Daftar!** | Salah satu PG terbesar di Indonesia, ada Sandbox, QRIS dinamis langsung aktif & ada webhook | ~0.7% |
| **Tripay** | Alternatif | API paling simpel untuk pemula | ~0.7% |
| **Midtrans** | Alternatif | Ekosistem GoTo | ~0.7% |

> [!TIP]
> **DOKU Bisa Banget & Sangat Cocok!**
> Karena kamu sudah daftar DOKU, kita akan langsung siapkan modul integrasi **DOKU (Jokul API)** untuk QRIS Dinamis + Webhook:
> 1. DOKU menyediakan API untuk generate string QRIS dinamis (yang bisa kita render langsung di kolom kiri web).
> 2. DOKU mengirim notifikasi webhook instan saat pembeli selesai scan & bayar.
> 3. Kita lengkapi juga dengan **Mode Simulator bawaan**, jadi sebelum kamu memasukkan Client ID & Secret Key DOKU (atau sambil menunggu verifikasi DOKU selesai), kita sudah bisa uji coba alur belanja secara penuh!

---

## Spesifikasi Terpilih

- **Produk**: Voucher Google AI Pro (Kapasitas: 10 Voucher)
- **Harga**: **Rp 75.000** (Otomatis terkunci di QRIS dinamis)
- **Format Delivery**: **Direct URL Claim** (Pembeli tinggal klik tombol "Buka & Klaim Voucher", browser langsung membuka halaman aktivasi Google AI Pro)
- **Alur Expire**: 10 Menit per sesi checkout. Jika pembeli batal / tidak bayar, voucher otomatis kembali ke stok.

---

## Proposed Changes

### File Structure Project (`f:\ANTIGRAVITY\bikinQRIS`)

```text
bikinQRIS/
├── .env.example                # Template konfigurasi (Harga, API Keys, Provider)
├── .env                        # Konfigurasi aktif (rahasia)
├── package.json                # Dependencies Express, SQLite/Better-Sqlite3, QRCode, Axios, etc.
├── server.js                   # Server utama Express & API endpoints
├── data/
│   ├── database.sqlite         # Database transaksi & stok voucher
│   └── vouchers.json           # Tempat memasukkan 10 link Google AI Pro
├── services/
│   ├── db.js                   # Manajemen SQLite (inits, queries, locks, transactions)
│   ├── payment/
│   │   ├── index.js            # Factory selector (doku / tripay / midtrans / simulator)
│   │   ├── doku.js             # Integrasi DOKU (Jokul) QRIS API & Webhook
│   │   ├── tripay.js           # Integrasi Tripay Open API
│   │   ├── midtrans.js         # Integrasi Midtrans Core API
│   │   └── simulator.js        # Mode simulasi untuk testing instan
│   └── stockManager.js         # Logic lock, unlock timeout, assign voucher FIFO
├── public/
│   ├── index.html              # Halaman Landing Page Checkout modern & responsive
│   ├── css/
│   │   └── style.css           # Styling modern (Dark luxury tech theme, animations)
│   └── js/
│       └── app.js              # State polling, countdown timer, realtime UI switch
└── admin/
    └── index.html              # Dashboard mini khusus kamu (lihat sisa voucher & riwayat transaksi)
```

---

## Desain Tampilan Sesuai Referensi Gambar (Two-Column Layout)

Berdasarkan referensi tampilan yang kamu kirim, kita buat persis dengan layout modern tersebut:

### 1. Header Bar
- **Logo Brand**: Kiri atas (misal: "AI Voucher" atau nama toko kamu).
- **Timer Pill**: Di tengah atas dengan icon stopwatch (`⏱ 09:59` saat aktif, `--:--` saat lunas).
- **Theme Switcher**: Kanan atas (Toggle Mode Terang / Mode Gelap).

### 2. Kolom Kiri (Area Dinamis: QRIS ➔ Sukses Voucher)
- **Saat Belum Bayar (Status PENDING)**:
  - Tampilan QRIS Dinamis besar dan tajam dengan logo standar QRIS Nasional.
  - Nominal otomatis terkunci **Rp 75.000**.
  - Panduan scan (BCA, Mandiri, BRI, BNI, GoPay, DANA, OVO, ShopeePay, dll).
- **Saat Pembayaran Berhasil (Status PAID)** (Persis seperti referensi):
  - Gambar QRIS otomatis **hilang seketika**.
  - Muncul icon lingkaran hijau centang animasi (`✓`).
  - Badge hijau: `● PEMBAYARAN BERHASIL`.
  - Judul: **"Pembayaran Berhasil!"**.
  - Subtitle: *"Terima kasih, pembayaran Anda telah berhasil diterima."*
  - **KOTAK KLAIM VOUCHER**:
    - Tombol Utama Besar: **`[ 🚀 KLAIM VOUCHER GOOGLE AI PRO ]`** (sekali klik langsung membuka link aktivasi Google AI Pro di tab baru).
    - Tombol Kedua: **`[ 📋 Salin Link Voucher ]`**.
    - Petunjuk ringkas cara aktivasi Google AI Pro.

### 3. Kolom Kanan (Area Rincian Transaksi & Struk)
- **Merchant Badge**: Nama toko / produk (misal: `Google AI Pro Store ✓`).
- **Nominal Besar**: `Rp 75.000` (Pembayaran via QRIS).
- **Nomor Pesanan**: `Pesanan GAIP-260912-XXXX`.
- **Card Rincian Pembayaran**:
  - Total Dibayar: `Rp 75.000`
  - ID Transaksi: `TX-XXXX-XXXX`
  - Nominal: `Rp 75.000`
  - Biaya Layanan: `Rp 0`
- **Alert Status Box**:
  - Belum bayar: *"Menunggu pembayaran... Silakan scan QRIS di samping."*
  - Sudah bayar: *"Pembayaran telah berhasil!"* (background hijau lembut).
- **Waktu Transaksi**: Tanggal & jam realtime.
- **Tombol Aksi**:
  - `[ 🔗 Bagikan ]` (Web Share API)
  - `[ 📥 Download Struk ]` (Download invoice/struk pembelian)
  - `[ 🔄 Cek Status Pembayaran ]` (Tombol ungu untuk trigger pengecekan instan)
- **Status Indicator**: `● Status diperbarui otomatis setiap beberapa detik` (auto-polling & webhook).
- **Security Footer**: `🔒 Semua data dilindungi dan terenkripsi dengan aman.`

---

## Verification Plan

### 1. Automated & Logic Tests
- Inisialisasi 10 dummy/real link voucher.
- Tes fungsi `lockVoucher()`: memastikan 1 voucher di-hold dan stok berkurang.
- Tes expired order timeout: memastikan voucher kembali aktif jika pembayaran tidak diselesaikan dalam 10 menit.
- Tes anti double-claim: memastikan 1 link voucher hanya bisa diberikan ke 1 pembeli yang sudah lunas.

### 2. Manual & End-to-End Simulation
- Menjalankan server lokal `node server.js`.
- Buka antarmuka checkout di browser.
- Klik "Beli Sekarang", cek tampilan QRIS dinamis.
- Trigger pembayaran sukses via webhook simulator.
- Verifikasi layar langsung menampilkan link voucher URL & stok berkurang jadi 9.

