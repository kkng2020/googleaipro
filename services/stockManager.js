const { readData, writeData } = require('../data/store');
const { supabase, isConfigured } = require('../data/supabaseClient');

class StockManager {
  static async cleanupExpiredLocks() {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // 1. Supabase Cleanup
    if (isConfigured()) {
      try {
        const { data: expiredVouchers } = await supabase
          .from('vouchers')
          .select('*')
          .eq('status', 'LOCKED')
          .lt('locked_until', nowIso);

        if (expiredVouchers && expiredVouchers.length > 0) {
          for (const v of expiredVouchers) {
            // Check if order was paid
            if (v.order_id) {
              const { data: ord } = await supabase
                .from('orders')
                .select('status')
                .eq('id', v.order_id)
                .single();

              if (ord && ord.status === 'PAID') {
                continue;
              }
            }

            // Unlock voucher
            await supabase
              .from('vouchers')
              .update({
                status: 'AVAILABLE',
                locked_until: null,
                order_id: null,
                updated_at: new Date().toISOString()
              })
              .eq('id', v.id);

            if (v.order_id) {
              await supabase
                .from('orders')
                .update({ status: 'EXPIRED' })
                .eq('id', v.order_id)
                .eq('status', 'PENDING');
            }
          }
        }
      } catch (err) {
        console.error('Supabase cleanupExpiredLocks error:', err.message);
      }
    }

    // 2. Local fallback cleanup
    const data = readData();
    let changed = false;
    for (const voucher of data.vouchers) {
      if (voucher.status === 'LOCKED' && voucher.lockedUntil && voucher.lockedUntil < now) {
        const order = data.orders.find(o => o.id === voucher.orderId);
        if (!order || order.status !== 'PAID') {
          voucher.status = 'AVAILABLE';
          voucher.lockedUntil = null;
          voucher.orderId = null;
          if (order && order.status === 'PENDING') {
            order.status = 'EXPIRED';
          }
          changed = true;
        }
      }
    }
    if (changed) {
      writeData(data);
    }
  }

  static async getStock() {
    await this.cleanupExpiredLocks();
    const localData = readData();

    if (isConfigured()) {
      try {
        const { data: vouchers, error } = await supabase
          .from('vouchers')
          .select('*')
          .order('id', { ascending: true });

        if (!error && vouchers && vouchers.length > 0) {
          const available = vouchers.filter(v => v.status === 'AVAILABLE').length;
          const locked = vouchers.filter(v => v.status === 'LOCKED').length;
          const sold = vouchers.filter(v => v.status === 'SOLD').length;
          const total = vouchers.length;

          return {
            total,
            available,
            locked,
            sold,
            settings: localData.settings
          };
        }
      } catch (err) {
        console.error('Supabase getStock error:', err.message);
      }
    }

    const available = localData.vouchers.filter(v => v.status === 'AVAILABLE').length;
    const locked = localData.vouchers.filter(v => v.status === 'LOCKED').length;
    const sold = localData.vouchers.filter(v => v.status === 'SOLD').length;
    const total = localData.vouchers.length;

    return {
      total,
      available,
      locked,
      sold,
      settings: localData.settings
    };
  }

  static async lockNextVoucher(orderId, buyerName = '', buyerPhone = '') {
    await this.cleanupExpiredLocks();
    const localData = readData();
    const timeoutMs = (localData.settings.orderTimeoutMinutes || 10) * 60 * 1000;
    const lockExpiry = Date.now() + timeoutMs;
    const lockExpiryIso = new Date(lockExpiry).toISOString();

    if (isConfigured()) {
      try {
        const { data: availableVouchers, error } = await supabase
          .from('vouchers')
          .select('*')
          .eq('status', 'AVAILABLE')
          .order('id', { ascending: true })
          .limit(1);

        if (!error && availableVouchers && availableVouchers.length > 0) {
          const voucher = availableVouchers[0];
          await supabase
            .from('vouchers')
            .update({
              status: 'LOCKED',
              locked_until: lockExpiryIso,
              order_id: orderId,
              buyer_name: buyerName,
              buyer_phone: buyerPhone,
              updated_at: new Date().toISOString()
            })
            .eq('id', voucher.id);

          // Update local copy too
          const locV = localData.vouchers.find(v => v.id === voucher.id);
          if (locV) {
            locV.status = 'LOCKED';
            locV.lockedUntil = lockExpiry;
            locV.orderId = orderId;
            locV.buyerName = buyerName;
            locV.buyerPhone = buyerPhone;
            writeData(localData);
          }

          return { voucherId: voucher.id, lockedUntil: lockExpiry };
        } else {
          throw new Error('Maaf, stok voucher saat ini sedang habis atau sedang diproses pembeli lain!');
        }
      } catch (err) {
        console.error('Supabase lockNextVoucher error:', err.message);
        if (err.message.includes('habis')) throw err;
      }
    }

    const voucher = localData.vouchers.find(v => v.status === 'AVAILABLE');
    if (!voucher) {
      throw new Error('Maaf, stok voucher saat ini sedang habis atau sedang diproses pembeli lain!');
    }

    voucher.status = 'LOCKED';
    voucher.lockedUntil = lockExpiry;
    voucher.orderId = orderId;
    voucher.buyerName = buyerName;
    voucher.buyerPhone = buyerPhone;

    writeData(localData);
    return { voucherId: voucher.id, lockedUntil: lockExpiry };
  }

  static async createOrder({ id, transactionId, amount, customerName, customerPhone, qrCodeData, qrCodeUrl, paymentUrl, expiresAt, provider = 'buatqris' }) {
    const lockResult = await this.lockNextVoucher(id, customerName, customerPhone);
    const localData = readData();

    // Use provider's exact expired_at if available
    let orderExpiryIso = new Date(lockResult.lockedUntil).toISOString();
    if (expiresAt) {
      try {
        let s = String(expiresAt).trim();
        if (s.includes(' ') && !s.includes('T')) {
          s = s.replace(' ', 'T') + '+07:00';
        }
        const parsed = new Date(s);
        if (!isNaN(parsed.getTime())) {
          orderExpiryIso = parsed.toISOString();
        }
      } catch (e) {
        console.warn('Expiry parse warning:', e.message);
      }
    }

    const newOrder = {
      id,
      transactionId: transactionId || null,
      amount,
      voucherId: lockResult.voucherId,
      status: 'PENDING',
      qrCodeData,
      qrCodeUrl,
      paymentUrl: paymentUrl || null,
      customerName: customerName || 'Pembeli',
      customerPhone: customerPhone || '',
      createdAt: new Date().toISOString(),
      expiresAt: orderExpiryIso,
      paidAt: null,
      provider
    };

    if (isConfigured()) {
      try {
        await supabase.from('orders').insert({
          id,
          amount,
          fee: 0,
          total: amount,
          customer_name: newOrder.customerName,
          customer_phone: newOrder.customerPhone,
          qr_code_data: qrCodeData,
          qr_code_url: qrCodeUrl,
          status: 'PENDING',
          voucher_url: null,
          provider,
          created_at: newOrder.createdAt,
          expires_at: newOrder.expiresAt,
          raw_data: {
            voucherId: lockResult.voucherId,
            transactionId: transactionId || null,
            paymentUrl: paymentUrl || null
          }
        });
      } catch (err) {
        console.error('Supabase createOrder error:', err.message);
      }
    }

    localData.orders.push(newOrder);
    writeData(localData);

    return newOrder;
  }

  static async getOrder(orderId) {
    await this.cleanupExpiredLocks();
    const localData = readData();

    if (isConfigured()) {
      try {
        let query = supabase.from('orders').select('*');
        // Match either by id or raw_data->>transactionId
        if (orderId) {
          const { data: dbOrder } = await supabase
            .from('orders')
            .select('*')
            .or(`id.eq.${orderId},raw_data->>transactionId.eq.${orderId}`)
            .limit(1)
            .maybeSingle();

          if (dbOrder) {
            let voucherUrl = dbOrder.voucher_url;
            let voucherId = dbOrder.raw_data?.voucherId;
            let paymentUrl = dbOrder.raw_data?.paymentUrl;

            if (dbOrder.status === 'PAID' && !voucherUrl && voucherId) {
              const { data: v } = await supabase
                .from('vouchers')
                .select('url')
                .eq('id', voucherId)
                .single();
              if (v) voucherUrl = v.url;
            }

            return {
              id: dbOrder.id,
              transactionId: dbOrder.raw_data?.transactionId || null,
              amount: Number(dbOrder.amount),
              fee: Number(dbOrder.fee || 0),
              total: Number(dbOrder.total || dbOrder.amount),
              voucherId,
              status: dbOrder.status,
              qrCodeData: dbOrder.qr_code_data,
              qrCodeUrl: dbOrder.qr_code_url,
              paymentUrl,
              customerName: dbOrder.customer_name,
              customerPhone: dbOrder.customer_phone,
              createdAt: dbOrder.created_at,
              expiresAt: dbOrder.expires_at,
              paidAt: dbOrder.paid_at,
              provider: dbOrder.provider,
              voucherUrl,
              isPaid: dbOrder.status === 'PAID',
              isExpired: dbOrder.status === 'EXPIRED'
            };
          }
        }
      } catch (err) {
        console.error('Supabase getOrder error:', err.message);
      }
    }

    const order = localData.orders.find(o => o.id === orderId || o.transactionId === orderId);
    if (!order) return null;

    let voucherUrl = null;
    let voucherId = null;

    if (order.status === 'PAID') {
      const voucher = localData.vouchers.find(v => v.id === order.voucherId);
      if (voucher) {
        voucherUrl = voucher.url;
        voucherId = voucher.id;
      }
    }

    return {
      ...order,
      voucherUrl,
      voucherId,
      isPaid: order.status === 'PAID',
      isExpired: order.status === 'EXPIRED'
    };
  }

  static async markAsPaid(orderIdOrTrxId, paymentDetails = {}) {
    const localData = readData();
    const paidAt = new Date().toISOString();
    let voucherUrl = null;
    let updatedOrder = null;

    if (isConfigured()) {
      try {
        const { data: dbOrder } = await supabase
          .from('orders')
          .select('*')
          .or(`id.eq.${orderIdOrTrxId},raw_data->>transactionId.eq.${orderIdOrTrxId}`)
          .limit(1)
          .maybeSingle();

        if (dbOrder) {
          const voucherId = dbOrder.raw_data?.voucherId;
          if (voucherId) {
            const { data: v } = await supabase
              .from('vouchers')
              .select('*')
              .eq('id', voucherId)
              .single();

            if (v) {
              voucherUrl = v.url;
              await supabase
                .from('vouchers')
                .update({
                  status: 'SOLD',
                  sold_at: paidAt,
                  locked_until: null,
                  buyer_phone: dbOrder.customer_phone,
                  updated_at: paidAt
                })
                .eq('id', voucherId);
            }
          }

          const { data: newDbOrder } = await supabase
            .from('orders')
            .update({
              status: 'PAID',
              paid_at: paidAt,
              voucher_url: voucherUrl,
              raw_data: {
                ...dbOrder.raw_data,
                paymentDetails
              }
            })
            .eq('id', dbOrder.id)
            .select()
            .single();

          updatedOrder = newDbOrder;
        }
      } catch (err) {
        console.error('Supabase markAsPaid error:', err.message);
      }
    }

    const order = localData.orders.find(o => o.id === orderIdOrTrxId || o.transactionId === orderIdOrTrxId);
    if (order) {
      order.status = 'PAID';
      order.paidAt = paidAt;
      order.paymentDetails = paymentDetails;

      const voucher = localData.vouchers.find(v => v.id === order.voucherId);
      if (voucher) {
        voucher.status = 'SOLD';
        voucher.soldAt = paidAt;
        voucher.lockedUntil = null;
        voucher.buyerPhone = order.customerPhone;
        voucherUrl = voucherUrl || voucher.url;
      }
      writeData(localData);

      return {
        order: {
          id: order.id,
          status: order.status,
          amount: order.amount,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          paidAt: order.paidAt
        },
        voucherUrl
      };
    }

    if (updatedOrder) {
      return {
        order: {
          id: updatedOrder.id,
          status: updatedOrder.status,
          amount: updatedOrder.amount,
          customerName: updatedOrder.customer_name,
          customerPhone: updatedOrder.customer_phone,
          paidAt: updatedOrder.paid_at
        },
        voucherUrl
      };
    }

    throw new Error(`Order ${orderIdOrTrxId} not found`);
  }

  static async getAllVouchers() {
    await this.cleanupExpiredLocks();
    if (isConfigured()) {
      try {
        const { data: vouchers, error } = await supabase
          .from('vouchers')
          .select('*')
          .order('id', { ascending: true });

        if (!error && vouchers && vouchers.length > 0) {
          return vouchers.map(v => ({
            id: v.id,
            url: v.url,
            status: v.status,
            lockedUntil: v.locked_until ? new Date(v.locked_until).getTime() : null,
            orderId: v.order_id,
            soldAt: v.sold_at,
            buyerName: v.buyer_name,
            buyerPhone: v.buyer_phone
          }));
        }
      } catch (err) {
        console.error('Supabase getAllVouchers error:', err.message);
      }
    }

    const localData = readData();
    return localData.vouchers;
  }

  static async updateVouchers(vouchers) {
    const localData = readData();
    const existingMap = new Map(localData.vouchers.map(v => [v.id, v]));

    // Strictly protect SOLD vouchers from modification
    const safeVouchersToUpdate = vouchers.filter(v => {
      const existing = existingMap.get(v.id);
      if (existing && existing.status === 'SOLD') {
        console.warn(`[StockManager] Voucher ${v.id} is SOLD and locked. Modification rejected.`);
        return false;
      }
      return true;
    });

    if (isConfigured()) {
      try {
        for (const v of safeVouchersToUpdate) {
          await supabase
            .from('vouchers')
            .upsert({
              id: v.id,
              url: v.url,
              status: v.status || 'AVAILABLE',
              updated_at: new Date().toISOString()
            });
        }
      } catch (err) {
        console.error('Supabase updateVouchers error:', err.message);
      }
    }

    // Apply updates locally only to non-SOLD vouchers
    for (const v of safeVouchersToUpdate) {
      const idx = localData.vouchers.findIndex(item => item.id === v.id);
      if (idx !== -1) {
        // Ensure status doesn't revert a sold voucher
        if (localData.vouchers[idx].status !== 'SOLD') {
          localData.vouchers[idx].url = v.url || localData.vouchers[idx].url;
        }
      }
    }

    writeData(localData);
    return localData.vouchers;
  }

  static async updateSingleVoucher(id, newUrl) {
    const localData = readData();
    const v = localData.vouchers.find(item => item.id === id);
    if (!v) {
      throw new Error(`Voucher dengan ID ${id} tidak ditemukan`);
    }
    if (v.status === 'SOLD') {
      throw new Error(`Voucher ${id} sudah terjual (LUNAS) dan terkunci permanen!`);
    }

    const cleanUrl = (newUrl || '').trim();
    if (!cleanUrl) {
      throw new Error('URL voucher tidak boleh kosong');
    }

    v.url = cleanUrl;
    writeData(localData);

    if (isConfigured()) {
      try {
        await supabase
          .from('vouchers')
          .update({
            url: cleanUrl,
            updated_at: new Date().toISOString()
          })
          .eq('id', id);
      } catch (err) {
        console.error('Supabase updateSingleVoucher error:', err.message);
      }
    }

    return v;
  }

  static async addVouchers(urls) {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('Daftar URL voucher tidak boleh kosong');
    }

    const cleanUrls = urls
      .map(u => (typeof u === 'string' ? u.trim() : ''))
      .filter(u => u.length > 0);

    if (cleanUrls.length === 0) {
      throw new Error('Tidak ada URL voucher valid yang dimasukkan');
    }

    const localData = readData();

    // Find highest existing voucher numeric suffix
    let maxNum = 0;
    for (const v of localData.vouchers) {
      const match = String(v.id).match(/(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }

    const newVouchers = [];
    for (let i = 0; i < cleanUrls.length; i++) {
      maxNum++;
      const id = `GAIP-VOUCHER-${String(maxNum).padStart(2, '0')}`;
      const newVoucher = {
        id,
        url: cleanUrls[i],
        status: 'AVAILABLE',
        lockedUntil: null,
        orderId: null,
        soldAt: null,
        buyerName: null,
        buyerPhone: null
      };
      newVouchers.push(newVoucher);
      localData.vouchers.push(newVoucher);
    }

    writeData(localData);

    if (isConfigured()) {
      try {
        for (const v of newVouchers) {
          await supabase.from('vouchers').insert({
            id: v.id,
            url: v.url,
            status: 'AVAILABLE',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error('Supabase addVouchers error:', err.message);
      }
    }

    return newVouchers;
  }

  static async deleteVoucher(voucherId) {
    const localData = readData();
    let voucher = null;

    if (isConfigured()) {
      try {
        const { data: dbVoucher } = await supabase
          .from('vouchers')
          .select('*')
          .eq('id', voucherId)
          .maybeSingle();

        if (dbVoucher) {
          voucher = {
            id: dbVoucher.id,
            url: dbVoucher.url,
            status: dbVoucher.status
          };
        }
      } catch (err) {
        console.error('Supabase check voucher error:', err.message);
      }
    }

    const idx = localData.vouchers.findIndex(v => v.id === voucherId);
    if (!voucher && idx !== -1) {
      voucher = localData.vouchers[idx];
    }

    if (!voucher && idx === -1) {
      throw new Error(`Voucher ${voucherId} tidak ditemukan`);
    }

    // Strict lock: SOLD vouchers cannot be deleted
    if (voucher && voucher.status === 'SOLD') {
      throw new Error(`Voucher ${voucherId} sudah terjual kepada pelanggan dan terkunci permanen, tidak boleh dihapus!`);
    }

    if (voucher && voucher.status === 'LOCKED') {
      throw new Error(`Voucher ${voucherId} sedang di-hold untuk pesanan yang sedang berjalan. Tunggu hingga selesai atau kadaluarsa.`);
    }

    if (idx !== -1) {
      localData.vouchers.splice(idx, 1);
      writeData(localData);
    }

    if (isConfigured()) {
      try {
        const { error } = await supabase.from('vouchers').delete().eq('id', voucherId);
        if (error) {
          console.error('Supabase delete error:', error.message);
        }
      } catch (err) {
        console.error('Supabase deleteVoucher error:', err.message);
      }
    }

    return { success: true, id: voucherId };
  }

  static async resetAllVouchersToAvailable() {
    if (isConfigured()) {
      try {
        await supabase
          .from('vouchers')
          .update({
            status: 'AVAILABLE',
            locked_until: null,
            order_id: null,
            sold_at: null,
            buyer_name: null,
            buyer_phone: null,
            updated_at: new Date().toISOString()
          })
          .neq('id', '');
      } catch (err) {
        console.error('Supabase resetAllVouchers error:', err.message);
      }
    }

    const localData = readData();
    localData.vouchers.forEach(v => {
      v.status = 'AVAILABLE';
      v.lockedUntil = null;
      v.orderId = null;
      v.soldAt = null;
      v.buyerName = null;
      v.buyerPhone = null;
    });
    writeData(localData);
    return localData.vouchers;
  }
}

module.exports = StockManager;
