// Supabase Edge Function: moolre-payment
// Initiates Moolre Mobile Money USSD collection on customer's phone without exposing API secrets.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const moolreBaseUrl = Deno.env.get('MOOLRE_API_BASE_URL') || 'https://api.moolre.com';
    const moolreUser = Deno.env.get('MOOLRE_API_USER');
    const moolrePubKey = Deno.env.get('MOOLRE_API_PUBKEY');
    const moolreAccount = Deno.env.get('MOOLRE_ACCOUNT_NUMBER');

    if (!moolreUser || !moolrePubKey || !moolreAccount) {
      return new Response(
        JSON.stringify({ error: 'Moolre merchant credentials are not configured on the server.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { saleId, payerPhone, network, amount, idempotencyKey } = await req.json();
    if (!saleId || !payerPhone || !network || !amount || amount <= 0) {
      return new Response(JSON.stringify({ error: 'Missing required payment fields.' }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const paymentRef = `MOMO-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

    const { error: insertErr } = await supabase.from('payments').insert({
      sale_id: saleId,
      payment_reference: paymentRef,
      method: 'momo',
      provider: 'moolre',
      network,
      payer_phone: payerPhone,
      amount,
      status: 'initiated',
      idempotency_key: idempotencyKey || paymentRef,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    if (insertErr) throw insertErr;

    const moolreResp = await fetch(`${moolreBaseUrl}/open/transact/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-USER': moolreUser,
        'X-API-PUBKEY': moolrePubKey,
        'Idempotency-Key': idempotencyKey || paymentRef,
      },
      body: JSON.stringify({
        type: 1,
        channel: network,
        currency: 'GHS',
        payer: payerPhone,
        amount: Number(amount).toFixed(2),
        externalref: paymentRef,
        accountnumber: moolreAccount,
        reference: `Shop Sale ${paymentRef}`,
      }),
    });

    const moolreData = await moolreResp.json().catch(() => ({}));

    if (!moolreResp.ok || moolreData?.status === 0) {
      await supabase
        .from('payments')
        .update({ status: 'failed', failure_reason: moolreData?.message || 'Moolre initiation failed' })
        .eq('payment_reference', paymentRef);

      return new Response(
        JSON.stringify({ error: moolreData?.message || 'Failed to initiate Moolre payment', paymentReference: paymentRef }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await supabase
      .from('payments')
      .update({
        status: 'awaiting_authorization',
        provider_tx_id: moolreData?.data?.transactionid ? String(moolreData.data.transactionid) : null,
      })
      .eq('payment_reference', paymentRef);

    return new Response(
      JSON.stringify({ paymentReference: paymentRef, status: 'awaiting_authorization', providerResponse: moolreData }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
