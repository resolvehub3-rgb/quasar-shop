// Supabase Edge Function: scheduled-reports
// Triggered by pg_cron daily to send 5-day or 7-day shop performance summaries via SasuSync.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: cfg } = await supabase.from('sms_configurations').select('*').limit(1).maybeSingle();
  if (!cfg || !cfg.scheduled_enabled || !cfg.scheduled_destination_phone) {
    return new Response(JSON.stringify({ skipped: true, reason: 'Scheduled SMS reports disabled or unconfigured' }), { status: 200 });
  }

  const freqDays = cfg.scheduled_frequency_days || 7;
  if (cfg.last_scheduled_sent_at) {
    const elapsedDays = (Date.now() - new Date(cfg.last_scheduled_sent_at).getTime()) / (1000 * 60 * 60 * 24);
    if (elapsedDays < freqDays) {
      return new Response(JSON.stringify({ skipped: true, reason: `Only ${elapsedDays.toFixed(1)} days elapsed (< ${freqDays})` }), { status: 200 });
    }
  }

  const since = new Date(Date.now() - freqDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: sales } = await supabase.from('sales').select('total_amount').eq('payment_status', 'paid').gte('created_at', since);
  const { data: expenses } = await supabase.from('expenses').select('amount').eq('status', 'recorded').gte('created_at', since);

  const totalSales = (sales || []).reduce((s, r) => s + Number(r.total_amount), 0);
  const totalExpenses = (expenses || []).reduce((s, r) => s + Number(r.amount), 0);
  const messageBody = `Shop ${freqDays}-Day Report: Sales GHS ${totalSales.toFixed(2)}, Expenses GHS ${totalExpenses.toFixed(2)}.`;

  const smsResp = await fetch(`${supabaseUrl}/functions/v1/sasusync-sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ eventType: 'scheduled_report', recipientPhone: cfg.scheduled_destination_phone, messageBody }),
  });

  if (smsResp.ok) {
    await supabase.from('sms_configurations').update({ last_scheduled_sent_at: new Date().toISOString() }).eq('id', cfg.id);
  }

  return new Response(JSON.stringify({ executed: true, smsStatus: smsResp.status }), { status: 200 });
});
