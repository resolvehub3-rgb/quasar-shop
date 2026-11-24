// Supabase Edge Function: sasusync-sms
// Server-side SMS gateway dispatcher. Never fabricates delivery when credentials/endpoint are absent.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const endpoint = Deno.env.get('SASUSYNC_API_ENDPOINT');
  const apiKey = Deno.env.get('SASUSYNC_API_KEY');
  const senderId = Deno.env.get('SASUSYNC_SENDER_ID') || 'ShopPOS';

  const { eventType, recipientPhone, messageBody, relatedEntityType, relatedEntityId } = await req.json();
  const rawPhone = String(recipientPhone || '').trim().replace(/^\+/, '');
  const normalizedRecipientPhone = rawPhone.startsWith('0') ? `233${rawPhone.slice(1)}` : rawPhone;

  if (!endpoint || !apiKey) {
    await supabase.from('sms_logs').insert({
      event_type: eventType || 'manual_test',
      recipient_phone: normalizedRecipientPhone || '',
      message_body: messageBody || '',
      provider: 'sasusync',
      status: 'blocked_missing_config',
      error_message: 'SasuSync API endpoint or API key is not configured.',
      related_entity_type: relatedEntityType || null,
      related_entity_id: relatedEntityId || null,
    });
    return new Response(
      JSON.stringify({ delivered: false, status: 'blocked_missing_config', error: 'SasuSync API credentials not configured.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to: normalizedRecipientPhone, sender: senderId, message: messageBody }),
    });
    const data = await resp.json().catch(() => ({}));
    const ok = resp.ok;

    await supabase.from('sms_logs').insert({
      event_type: eventType || 'manual_test',
      recipient_phone: normalizedRecipientPhone,
      message_body: messageBody,
      provider: 'sasusync',
      provider_reference: data?.reference || data?.id || null,
      status: ok ? 'sent' : 'failed',
      error_message: ok ? null : data?.message || `HTTP ${resp.status}`,
      related_entity_type: relatedEntityType || null,
      related_entity_id: relatedEntityId || null,
    });

    return new Response(JSON.stringify({ delivered: ok, providerResponse: data }), { status: ok ? 200 : 502 });
  } catch (err) {
    await supabase.from('sms_logs').insert({
      event_type: eventType || 'manual_test',
      recipient_phone: recipientPhone,
      message_body: messageBody,
      provider: 'sasusync',
      status: 'failed',
      error_message: err instanceof Error ? err.message : 'Network error',
      related_entity_type: relatedEntityType || null,
      related_entity_id: relatedEntityId || null,
    });
    return new Response(JSON.stringify({ delivered: false, error: 'SMS dispatch failed' }), { status: 500 });
  }
});
