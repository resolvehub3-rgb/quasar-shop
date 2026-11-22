import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, CheckCircle2, AlertTriangle, Receipt, Upload } from 'lucide-react';
import { formatGHS } from '../lib/posCalculations';

export const ExpenseSubmitMobilePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [validating, setValidating] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{
    cashierName: string;
    shiftRef: string;
    expiresAt: string;
    categories: Array<{ id: string; name: string }>;
  } | null>(null);

  const [expenseName, setExpenseName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [paymentSource, setPaymentSource] = useState<'cash_drawer' | 'momo' | 'other'>('cash_drawer');
  const [description, setDescription] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState('image/jpeg');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedExpense, setSubmittedExpense] = useState<{
    expense_ref: string;
    amount: number;
    expense_name: string;
  } | null>(null);

  useEffect(() => {
    if (!token) {
      setTokenError('Missing expense QR token.');
      setValidating(false);
      return;
    }

    fetch(`/api/expense-qr/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Invalid or expired QR link');
        setSessionInfo({
          cashierName: json.cashier?.full_name || 'Cashier',
          shiftRef: json.shift?.shift_ref || '',
          expiresAt: json.expiresAt,
          categories: json.categories || [],
        });
        if (json.categories?.length > 0) {
          setCategoryName(json.categories[0].name);
        }
      })
      .catch((err) => setTokenError(err instanceof Error ? err.message : 'Unable to validate QR link'))
      .finally(() => setValidating(false));
  }, [token]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageMimeType(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = () => {
      setImageDataUrl(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !imageDataUrl) {
      setSubmitError('Please attach a photograph of the item, invoice, or receipt.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const resp = await fetch(`/api/expense-qr/${encodeURIComponent(token)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseName,
          categoryName: categoryName || 'Miscellaneous',
          amount: Number(amount),
          paymentSource,
          description,
          imageBase64: imageDataUrl,
          imageMimeType,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to submit expense');
      setSubmittedExpense(data.expense);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex flex-col items-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-[#E5E7EB] shadow-sm overflow-hidden">
        <div className="bg-[#E60000] px-5 py-4 text-white flex items-center gap-3">
          <Receipt className="h-5 w-5" />
          <div>
            <h1 className="font-display text-base font-bold">Expense Evidence Submission</h1>
            <p className="text-xs text-white/85">Single-use verified shop expense upload</p>
          </div>
        </div>

        <div className="p-5">
          {validating ? (
            <p className="py-10 text-center text-sm text-[#6B7280]">Validating QR session...</p>
          ) : tokenError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center">
              <AlertTriangle className="h-8 w-8 text-[#E60000] mx-auto mb-2" />
              <h2 className="text-sm font-bold text-[#1F2937]">QR Session Unavailable</h2>
              <p className="text-xs text-red-700 mt-1">{tokenError}</p>
            </div>
          ) : submittedExpense ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto mb-3" />
              <h2 className="font-display text-lg font-bold text-[#1F2937]">Expense Recorded</h2>
              <p className="text-xs text-[#4B5563] mt-1">
                Reference <span className="font-mono font-semibold">{submittedExpense.expense_ref}</span>
              </p>
              <p className="mt-3 text-xl font-bold text-[#1F2937] tabular-nums">
                {formatGHS(Number(submittedExpense.amount))}
              </p>
              <p className="text-xs text-[#6B7280] mt-1">{submittedExpense.expense_name}</p>
              <p className="mt-4 text-xs text-emerald-700">
                This single-use QR link is now closed. The shop owner dashboard and POS shift summary have been updated.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {sessionInfo && (
                <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3 text-xs flex justify-between">
                  <div>
                    <span className="text-[#6B7280]">Cashier:</span>{' '}
                    <strong className="text-[#1F2937]">{sessionInfo.cashierName}</strong>
                  </div>
                  <div className="font-mono text-[#6B7280]">{sessionInfo.shiftRef}</div>
                </div>
              )}

              {submitError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {submitError}
                </div>
              )}

              <div>
                <label htmlFor="exp-name" className="block text-xs font-semibold text-[#1F2937] mb-1">
                  Expense Name
                </label>
                <input
                  id="exp-name"
                  type="text"
                  required
                  value={expenseName}
                  onChange={(e) => setExpenseName(e.target.value)}
                  placeholder="e.g. Generator Fuel / Polythene Bags"
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2.5 text-sm focus:outline-none focus:border-[#E60000]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="exp-amount" className="block text-xs font-semibold text-[#1F2937] mb-1">
                    Amount (GH₵)
                  </label>
                  <input
                    id="exp-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2.5 text-sm tabular-nums focus:outline-none focus:border-[#E60000]"
                  />
                </div>
                <div>
                  <label htmlFor="exp-category" className="block text-xs font-semibold text-[#1F2937] mb-1">
                    Category
                  </label>
                  <select
                    id="exp-category"
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-[#E60000]"
                  >
                    {(sessionInfo?.categories.length
                      ? sessionInfo.categories
                      : [{ id: 'misc', name: 'Miscellaneous' }]
                    ).map((cat) => (
                      <option key={cat.id} value={cat.name}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-[#1F2937] mb-1.5">Payment Source</span>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'cash_drawer', label: 'Cash Drawer' },
                    { id: 'momo', label: 'MoMo' },
                    { id: 'other', label: 'Other' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPaymentSource(opt.id as 'cash_drawer' | 'momo' | 'other')}
                      className={`rounded-lg border py-2 px-2 text-xs font-semibold transition-colors cursor-pointer ${
                        paymentSource === opt.id
                          ? 'border-[#E60000] bg-red-50 text-[#E60000]'
                          : 'border-[#E5E7EB] bg-white text-[#4B5563]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="exp-photo" className="block text-xs font-semibold text-[#1F2937] mb-1">
                  Photo of Item, Invoice, or Receipt (Required)
                </label>
                <label
                  htmlFor="exp-photo"
                  className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-4 cursor-pointer hover:border-[#E60000] transition-colors"
                >
                  {imageDataUrl ? (
                    <img
                      src={imageDataUrl}
                      alt="Expense evidence preview"
                      className="max-h-44 rounded-lg object-contain"
                    />
                  ) : (
                    <>
                      <Camera className="h-7 w-7 text-[#E60000] mb-1.5" />
                      <span className="text-xs font-semibold text-[#1F2937]">
                        Tap to capture or upload receipt photo
                      </span>
                      <span className="text-[11px] text-[#6B7280] mt-0.5">JPEG, PNG, or WebP up to 5 MB</span>
                    </>
                  )}
                  <input
                    id="exp-photo"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
              </div>

              <div>
                <label htmlFor="exp-desc" className="block text-xs font-semibold text-[#1F2937] mb-1">
                  Description (Optional)
                </label>
                <textarea
                  id="exp-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Additional notes..."
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm focus:outline-none focus:border-[#E60000]"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#E60000] py-3 text-sm font-semibold text-white hover:bg-[#cc0000] disabled:opacity-60 cursor-pointer"
              >
                <Upload className="h-4 w-4" />
                {submitting ? 'Uploading Evidence...' : 'Submit Expense'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
