const { supabase, isConfigured } = require('../data/supabaseClient');

function ensureSupabase() {
  if (!isConfigured()) {
    throw new Error('Database Supabase tidak terhubung! Pastikan SUPABASE_URL dan SUPABASE_KEY terisi dengan benar di .env.');
  }
  return supabase;
}

class StockManager {
  /**
   * Cleans up expired voucher locks and marks associated pending orders as EXPIRED
   */
  static async cleanupExpiredLocks() {
    const client = ensureSupabase();
    const nowIso = new Date().toISOString();

    try {
      const { data: expiredVouchers, error: expErr } = await client
        .from('vouchers')
        .select('*')
        .eq('status', 'LOCKED')
        .lt('locked_until', nowIso);

      if (expErr) {
        console.error('[StockManager] Error selecting expired vouchers:', expErr.message);
        return;
      }

      if (expiredVouchers && expiredVouchers.length > 0) {
        for (const v of expiredVouchers) {
          // If order was already paid, do not unlock
          if (v.order_id) {
            const { data: ord } = await client
              .from('orders')
              .select('status')
              .eq('id', v.order_id)
              .maybeSingle();

            if (ord && ord.status === 'PAID') {
              continue;
            }

            // Mark pending order as EXPIRED
            if (ord && ord.status === 'PENDING') {
              await client
                .from('orders')
                .update({ status: 'EXPIRED' })
                .eq('id', v.order_id);
            }
          }

          // Unlock voucher back to AVAILABLE
          await client
            .from('vouchers')
            .update({
              status: 'AVAILABLE',
              locked_until: null,
              order_id: null,
              buyer_name: null,
              buyer_phone: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', v.id);
          console.log(`[StockManager] Voucher #${v.id} unlocked back to AVAILABLE (timeout).`);
        }
      }

      // 2. Also check any PENDING orders whose expires_at is past nowIso
      // 2. Also check any PENDING orders where voucher hold (10 mins) has elapsed
      const { data: expiredOrders, error: ordErr } = await client
        .from('orders')
        .select('*')
        .eq('status', 'PENDING');

      if (!ordErr && expiredOrders && expiredOrders.length > 0) {
        for (const ord of expiredOrders) {
          const lockedUntil = ord.raw_data?.lockedUntil;
          const isHoldExpired = lockedUntil
            ? Date.now() > new Date(lockedUntil).getTime()
            : (ord.expires_at && Date.now() > (new Date(ord.expires_at).getTime() + 5 * 60 * 1000));

          if (isHoldExpired) {
            await client
              .from('orders')
              .update({ status: 'EXPIRED' })
              .eq('id', ord.id);

            await client
              .from('vouchers')
              .update({
                status: 'AVAILABLE',
                locked_until: null,
                order_id: null,
                buyer_name: null,
                buyer_phone: null,
                updated_at: new Date().toISOString()
              })
              .eq('order_id', ord.id)
              .eq('status', 'LOCKED');
            console.log(`[StockManager] Order #${ord.id} reached 10-min hold limit. Marked EXPIRED & voucher released.`);
          }
        }
      }
    } catch (err) {
      console.error('[StockManager] cleanupExpiredLocks error:', err.message);
    }
  }

  /**
   * Retrieves store settings directly from Supabase
   */
  static async getSettings() {
    const client = ensureSupabase();
    try {
      const { data, error } = await client
        .from('settings')
        .select('value')
        .eq('key', 'store')
        .maybeSingle();

      if (error) {
        console.warn('[StockManager] Warning getting settings from Supabase:', error.message);
      }

      if (data && data.value) {
        return data.value;
      }
    } catch (e) {
      console.error('[StockManager] Settings error:', e.message);
    }

    return {
      productName: 'Google AI Pro Voucher (Aktivasi Resmi)',
      price: 75000,
      fee: 0,
      currency: 'Rp',
      merchantName: 'mybrotools',
      orderTimeoutMinutes: 5,
      voucherHoldMinutes: 10,
      supportContact: 'https://wa.me/'
    };
  }

  /**
   * Updates store settings directly in Supabase
   */
  static async updateSettings(newSettings) {
    const client = ensureSupabase();
    const current = await this.getSettings();
    const merged = { ...current, ...newSettings };

    const { error } = await client
      .from('settings')
      .upsert({
        key: 'store',
        value: merged,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;
    return merged;
  }

  /**
   * Returns current stock numbers directly from Supabase
   * Note: cleanupExpiredLocks() runs automatically every 30s in server.js background interval
   */
  static async getStock() {
    const client = ensureSupabase();

    // Run voucher count + settings queries in parallel for faster response
    const [voucherResult, settings] = await Promise.all([
      client
        .from('vouchers')
        .select('status')
        .order('id', { ascending: true }),
      this.getSettings()
    ]);

    if (voucherResult.error) {
      console.error('[StockManager] Supabase getStock error:', voucherResult.error.message);
      throw voucherResult.error;
    }

    const list = voucherResult.data || [];
    const available = list.filter(v => v.status === 'AVAILABLE').length;
    const locked = list.filter(v => v.status === 'LOCKED').length;
    const sold = list.filter(v => v.status === 'SOLD').length;
    const total = list.length;

    return {
      total,
      available,
      locked,
      sold,
      settings
    };
  }

  /**
   * Locks the next available voucher for checkout in Supabase
   */
  static async lockNextVoucher(orderId, buyerName = '', buyerPhone = '') {
    await this.cleanupExpiredLocks();
    const client = ensureSupabase();
    const settings = await this.getSettings();
    const holdMinutes = Number(settings.voucherHoldMinutes) || 10;
    const holdMs = holdMinutes * 60 * 1000;
    const lockExpiry = Date.now() + holdMs;
    const lockExpiryIso = new Date(lockExpiry).toISOString();

    const { data: availableVouchers, error } = await client
      .from('vouchers')
      .select('*')
      .eq('status', 'AVAILABLE')
      .order('id', { ascending: true })
      .limit(1);

    if (error) throw error;

    if (!availableVouchers || availableVouchers.length === 0) {
      throw new Error('Maaf, stok voucher saat ini sedang habis atau sedang diproses pembeli lain!');
    }

    const voucher = availableVouchers[0];
    const { error: lockErr } = await client
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

    if (lockErr) throw lockErr;

    return { voucherId: voucher.id, lockedUntil: lockExpiry };
  }

  /**
   * Creates a new order directly in Supabase orders table
   */
  static async createOrder(orderData) {
    const client = ensureSupabase();
    const settings = await this.getSettings();
    const orderTimeoutMinutes = Number(settings.orderTimeoutMinutes) || 5;
    const orderExpiresIso = new Date(Date.now() + orderTimeoutMinutes * 60 * 1000).toISOString();

    const lockResult = await this.lockNextVoucher(
      orderData.id,
      orderData.customerName,
      orderData.customerPhone
    );

    const newOrder = {
      id: orderData.id,
      amount: orderData.amount,
      fee: orderData.fee || 0,
      total: orderData.total || orderData.amount,
      customer_name: orderData.customerName || 'Pembeli',
      customer_phone: orderData.customerPhone || '',
      qr_code_data: orderData.qrCodeData || null,
      qr_code_url: orderData.qrCodeUrl || null,
      status: 'PENDING',
      voucher_url: null,
      provider: orderData.provider || 'buatqris',
      created_at: new Date().toISOString(),
      expires_at: orderExpiresIso, // 5 menit batas bayar pembeli & countdown
      paid_at: null,
      raw_data: {
        transactionId: orderData.transactionId || null,
        paymentUrl: orderData.paymentUrl || null,
        voucherId: lockResult.voucherId,
        lockedUntil: lockResult.lockedUntil // 10 menit batas hold voucher (grace period)
      }
    };

    const { data, error } = await client
      .from('orders')
      .insert(newOrder)
      .select()
      .single();

    if (error) {
      console.error('[StockManager] Supabase createOrder error:', error.message);
      throw error;
    }

    return {
      id: data.id,
      transactionId: orderData.transactionId || null,
      amount: data.amount,
      voucherId: lockResult.voucherId,
      customerName: data.customer_name,
      customerPhone: data.customer_phone,
      status: data.status,
      qrCodeData: data.qr_code_data,
      qrCodeUrl: data.qr_code_url,
      paymentUrl: orderData.paymentUrl || null,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      provider: data.provider
    };
  }

  /**
   * Finds an order by ID or transaction ID directly from Supabase
   */
  static async getOrder(orderIdOrTrxId) {
    const client = ensureSupabase();

    const { data: dbOrder, error } = await client
      .from('orders')
      .select('*')
      .or(`id.eq.${orderIdOrTrxId},raw_data->>transactionId.eq.${orderIdOrTrxId}`)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[StockManager] Supabase getOrder error:', error.message);
    }
    if (!dbOrder) return null;

    // Check if pending order has passed its 10-minute voucher hold expiration
    if (dbOrder.status === 'PENDING') {
      const lockedUntil = dbOrder.raw_data?.lockedUntil;
      const isHoldExpired = lockedUntil
        ? Date.now() > new Date(lockedUntil).getTime()
        : (dbOrder.expires_at && Date.now() > (new Date(dbOrder.expires_at).getTime() + 5 * 60 * 1000));

      if (isHoldExpired) {
        dbOrder.status = 'EXPIRED';
        await client
          .from('orders')
          .update({ status: 'EXPIRED' })
          .eq('id', dbOrder.id);

        await client
          .from('vouchers')
          .update({
            status: 'AVAILABLE',
            locked_until: null,
            order_id: null,
            buyer_name: null,
            buyer_phone: null,
            updated_at: new Date().toISOString()
          })
          .eq('order_id', dbOrder.id)
          .eq('status', 'LOCKED');
        console.log(`[StockManager] Order ${dbOrder.id} reached 10-min hold limit. Marked EXPIRED & voucher released.`);
      }
    }

    let voucherUrl = dbOrder.voucher_url;
    let voucherId = dbOrder.raw_data?.voucherId || null;

    if (dbOrder.status === 'PAID') {
      if (!voucherUrl && voucherId) {
        const { data: v } = await client
          .from('vouchers')
          .select('url')
          .eq('id', voucherId)
          .maybeSingle();

        if (v) voucherUrl = v.url;
      }
    }

    return {
      id: dbOrder.id,
      transactionId: dbOrder.raw_data?.transactionId || null,
      amount: dbOrder.amount,
      fee: dbOrder.fee || 0,
      total: dbOrder.total || dbOrder.amount,
      customerName: dbOrder.customer_name,
      customerPhone: dbOrder.customer_phone,
      qrCodeData: dbOrder.qr_code_data,
      qrCodeUrl: dbOrder.qr_code_url,
      paymentUrl: dbOrder.raw_data?.paymentUrl || null,
      status: dbOrder.status,
      voucherUrl,
      voucherId,
      provider: dbOrder.provider,
      createdAt: dbOrder.created_at,
      expiresAt: dbOrder.expires_at,
      paidAt: dbOrder.paid_at,
      isPaid: dbOrder.status === 'PAID',
      isExpired: dbOrder.status === 'EXPIRED'
    };
  }

  /**
   * Manually or Webhook triggers an order expiration and immediately releases the locked voucher
   */
  static async markAsExpired(orderIdOrTrxId) {
    const client = ensureSupabase();

    const { data: dbOrder, error } = await client
      .from('orders')
      .select('*')
      .or(`id.eq.${orderIdOrTrxId},raw_data->>transactionId.eq.${orderIdOrTrxId}`)
      .limit(1)
      .maybeSingle();

    if (error || !dbOrder) return null;
    if (dbOrder.status === 'PAID') return dbOrder;

    await client
      .from('orders')
      .update({ status: 'EXPIRED' })
      .eq('id', dbOrder.id);

    await client
      .from('vouchers')
      .update({
        status: 'AVAILABLE',
        locked_until: null,
        order_id: null,
        buyer_name: null,
        buyer_phone: null,
        updated_at: new Date().toISOString()
      })
      .eq('order_id', dbOrder.id)
      .eq('status', 'LOCKED');

    console.log(`[StockManager] Order ${dbOrder.id} marked as EXPIRED & voucher released.`);
    return { ...dbOrder, status: 'EXPIRED' };
  }

  /**
   * Marks an order as PAID in Supabase and permanently binds the sold voucher
   */
  static async markAsPaid(orderIdOrTrxId, paymentDetails = {}) {
    const client = ensureSupabase();

    const { data: dbOrder, error } = await client
      .from('orders')
      .select('*')
      .or(`id.eq.${orderIdOrTrxId},raw_data->>transactionId.eq.${orderIdOrTrxId}`)
      .limit(1)
      .maybeSingle();

    if (error || !dbOrder) {
      throw new Error(`Order ${orderIdOrTrxId} tidak ditemukan di database Supabase`);
    }

    const paidAt = new Date().toISOString();
    let voucherUrl = dbOrder.voucher_url;
    const voucherId = dbOrder.raw_data?.voucherId;

    if (voucherId) {
      const { data: v } = await client
        .from('vouchers')
        .select('*')
        .eq('id', voucherId)
        .single();

      if (v) {
        voucherUrl = v.url;
        await client
          .from('vouchers')
          .update({
            status: 'SOLD',
            sold_at: paidAt,
            locked_until: null,
            order_id: dbOrder.id,
            buyer_name: dbOrder.customer_name,
            buyer_phone: dbOrder.customer_phone,
            updated_at: paidAt
          })
          .eq('id', voucherId);
      }
    }

    const updatedRawData = {
      ...(dbOrder.raw_data || {}),
      paymentDetails
    };

    const { data: updatedOrder, error: updateErr } = await client
      .from('orders')
      .update({
        status: 'PAID',
        paid_at: paidAt,
        voucher_url: voucherUrl,
        raw_data: updatedRawData
      })
      .eq('id', dbOrder.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return {
      order: {
        id: updatedOrder.id,
        transactionId: updatedOrder.transaction_id || updatedRawData?.transactionId || null,
        voucherId: voucherId || updatedRawData?.voucherId || null,
        status: updatedOrder.status,
        amount: updatedOrder.amount,
        customerName: updatedOrder.customer_name,
        customerPhone: updatedOrder.customer_phone,
        paidAt: updatedOrder.paid_at
      },
      voucherUrl
    };
  }

  /**
   * Retrieves overall sales statistics (total omzet and available stock)
   */
  static async getSalesStats() {
    const client = ensureSupabase();
    try {
      const [{ data: paidOrders, error: ordErr }, stock] = await Promise.all([
        client
          .from('orders')
          .select('amount')
          .eq('status', 'PAID'),
        this.getStock()
      ]);

      if (ordErr) console.warn('[StockManager] getSalesStats orders error:', ordErr.message);

      const totalOmzet = (paidOrders || []).reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
      return {
        totalOmzet,
        availableStock: stock.available,
        totalStock: stock.total
      };
    } catch (e) {
      console.error('[StockManager] getSalesStats error:', e.message);
      return { totalOmzet: 0, availableStock: 0, totalStock: 0 };
    }
  }

  /**
   * Returns all vouchers directly from Supabase
   */
  static async getAllVouchers() {
    await this.cleanupExpiredLocks();
    const client = ensureSupabase();

    const { data: vouchers, error } = await client
      .from('vouchers')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;

    return (vouchers || []).map(v => ({
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

  /**
   * Returns all orders directly from Supabase
   */
  static async getAllOrders() {
    const client = ensureSupabase();

    const { data: orders, error } = await client
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (orders || []).map(o => ({
      id: o.id,
      amount: o.amount,
      fee: o.fee || 0,
      total: o.total || o.amount,
      customerName: o.customer_name,
      customerPhone: o.customer_phone,
      status: o.status,
      voucherUrl: o.voucher_url,
      voucherId: o.raw_data?.voucherId || null,
      provider: o.provider,
      createdAt: o.created_at,
      expiresAt: o.expires_at,
      paidAt: o.paid_at
    }));
  }

  /**
   * Updates voucher URLs in Supabase, strictly protecting SOLD vouchers
   */
  static async updateVouchers(vouchers) {
    const client = ensureSupabase();

    const { data: currentVouchers } = await client
      .from('vouchers')
      .select('id, status');

    const statusMap = new Map((currentVouchers || []).map(v => [v.id, v.status]));

    for (const v of vouchers) {
      if (statusMap.get(v.id) === 'SOLD') {
        console.warn(`[StockManager] Voucher ${v.id} is SOLD. Modification rejected.`);
        continue;
      }
      await client
        .from('vouchers')
        .update({
          url: v.url,
          status: v.status || 'AVAILABLE',
          updated_at: new Date().toISOString()
        })
        .eq('id', v.id);
    }

    return this.getAllVouchers();
  }

  /**
   * Updates a single voucher link in Supabase
   */
  static async updateSingleVoucher(id, newUrl) {
    const client = ensureSupabase();

    const { data: v, error } = await client
      .from('vouchers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !v) {
      throw new Error(`Voucher dengan ID ${id} tidak ditemukan di database Supabase`);
    }
    if (v.status === 'SOLD') {
      throw new Error(`Voucher ${id} sudah terjual (LUNAS) dan terkunci permanen!`);
    }

    const cleanUrl = (newUrl || '').trim();
    if (!cleanUrl) {
      throw new Error('URL voucher tidak boleh kosong');
    }

    const { data: updated, error: updErr } = await client
      .from('vouchers')
      .update({
        url: cleanUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updErr) throw updErr;
    return updated;
  }

  /**
   * Adds new vouchers directly into Supabase
   */
  static async addVouchers(urls) {
    const client = ensureSupabase();
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('Daftar URL voucher tidak boleh kosong');
    }

    const cleanUrls = urls
      .map(u => (typeof u === 'string' ? u.trim() : ''))
      .filter(u => u.length > 0);

    if (cleanUrls.length === 0) {
      throw new Error('Tidak ada URL voucher valid yang dimasukkan');
    }

    const { data: allV } = await client
      .from('vouchers')
      .select('id');

    let maxNum = 0;
    for (const v of (allV || [])) {
      const match = String(v.id).match(/(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }

    const rowsToInsert = cleanUrls.map(url => {
      maxNum++;
      return {
        id: `GAIP-VOUCHER-${String(maxNum).padStart(2, '0')}`,
        url,
        status: 'AVAILABLE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    const { data, error } = await client
      .from('vouchers')
      .insert(rowsToInsert)
      .select();

    if (error) throw error;
    return data;
  }

  /**
   * Deletes a voucher directly from Supabase (protecting SOLD/LOCKED)
   */
  static async deleteVoucher(voucherId) {
    const client = ensureSupabase();

    const { data: v, error } = await client
      .from('vouchers')
      .select('*')
      .eq('id', voucherId)
      .maybeSingle();

    if (error || !v) {
      throw new Error(`Voucher ${voucherId} tidak ditemukan di database Supabase`);
    }

    if (v.status === 'SOLD') {
      throw new Error(`Voucher ${voucherId} sudah terjual kepada pelanggan dan terkunci permanen, tidak boleh dihapus!`);
    }

    if (v.status === 'LOCKED') {
      throw new Error(`Voucher ${voucherId} sedang di-hold untuk pesanan yang sedang berjalan.`);
    }

    const { error: delErr } = await client
      .from('vouchers')
      .delete()
      .eq('id', voucherId);

    if (delErr) throw delErr;

    return { success: true, id: voucherId };
  }

  /**
   * Resets all vouchers in Supabase to AVAILABLE
   */
  static async resetAllVouchersToAvailable() {
    const client = ensureSupabase();

    const { error } = await client
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

    if (error) throw error;
    return this.getAllVouchers();
  }
}

module.exports = StockManager;
