// Supabase Edge Function: moolre-webhook
// Verifies X-Moolre-Signature, enforces event_id idempotency, and confirms sale payment atomically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

async function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return computedHex.toLowerCase() === signatureHeader.trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const webhookSecret = Deno.env.get('MOOLRE_WEBHOOK_SECRET') || '';
  const signature = req.headers.get('X-Moolre-Signature');
  const signatureValid = await verifySignature(rawBody, signature, webhookSecret);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const payload = JSON.parse(rawBody);
  const eventId = payload.event_id || `${payload.event || 'moolre'}-${payload?.data?.externalref || Date.now()}`;
  const externalRef = payload?.data?.externalref;

  const { error: eventErr } = await supabase.from('payment_webhook_events').insert({
    event_id: eventId,
    provider: 'moolre',
    event_type: payload.event || String(payload.code || 'unknown'),
    payment_reference: externalRef || null,
    raw_payload: payload,
    signature_valid: signatureValid,
    processed: false,
  });

  // Duplicate callback protection
  if (eventErr && eventErr.code === '23505') {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 });
  }

  if (!signatureValid) {
    return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), { status: 401 });
  }

  const txStatus = payload?.data?.txstatus ?? payload?.status;
  const newStatus = txStatus === 1 || payload?.event === 'payment.succeeded' ? 'successful' : 'failed';

  const { error: rpcErr } = await supabase.rpc('fn_confirm_moolre_payment', {
    p_payment_reference: externalRef,
    p_provider_tx_id: payload?.data?.transactionid ? String(payload.data.transactionid) : null,
    p_new_status: newStatus,
    p_failure_reason: newStatus === 'failed' ? payload?.data?.reason || payload?.message || 'Payment failed' : null,
  });

  await supabase
    .from('payment_webhook_events')
    .update({ processed: !rpcErr, processing_error: rpcErr ? rpcErr.message : null })
    .eq('event_id', eventId);

  return new Response(JSON.stringify({ ok: !rpcErr }), { status: rpcErr ? 500 : 200 });
});
