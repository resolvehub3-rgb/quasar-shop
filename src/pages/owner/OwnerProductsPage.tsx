import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Archive, Scale, SlidersHorizontal, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { formatGHS } from '../../lib/posCalculations';
import { evaluateStockAlert } from '../../lib/inventoryMath';
import type { Category, MeasurementUnit, Product } from '../../types/database';

export const OwnerProductsPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<MeasurementUnit[]>([]);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create / Edit Product Modal
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [sku, setSku] = useState('');
  const [skuTouched, setSkuTouched] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [baseUnitId, setBaseUnitId] = useState('');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [openingStock, setOpeningStock] = useState('0');
  const [minStockLevel, setMinStockLevel] = useState('5');
  const [expiryDate, setExpiryDate] = useState('');
  const [description, setDescription] = useState('');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // New Category inline
  const [newCategoryName, setNewCategoryName] = useState('');

  // Unit Conversion Modal
  const [convModalProduct, setConvModalProduct] = useState<Product | null>(null);
  const [convUnitName, setConvUnitName] = useState('');
  const [convUnitCode, setConvUnitCode] = useState('');
  const [convFactor, setConvFactor] = useState('');
  const [convPrice, setConvPrice] = useState('');
  const [convIsPurchase, setConvIsPurchase] = useState(false);
  const [convIsSale, setConvIsSale] = useState(true);

  // Stock Adjustment Modal
  const [adjModalProduct, setAdjModalProduct] = useState<Product | null>(null);
  const [adjType, setAdjType] = useState<'stock_adjustment' | 'damaged_stock' | 'expired_stock' | 'opening_stock'>('stock_adjustment');
  const [adjDelta, setAdjDelta] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const loadAll = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [prodRes, catRes, unitRes] = await Promise.all([
        supabase
          .from('products')
          .select('*, measurement_units(*), categories(name), product_unit_conversions(*)')
          .order('name'),
        supabase.from('categories').select('*').order('name'),
        supabase.from('measurement_units').select('*').order('name'),
      ]);
      if (prodRes.error) throw prodRes.error;
      setProducts((prodRes.data as unknown as Product[]) || []);
      setCategories((catRes.data as Category[]) || []);
      setUnits((unitRes.data as MeasurementUnit[]) || []);
      if (unitRes.data?.length && !baseUnitId) {
        setBaseUnitId(unitRes.data[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load products');
    } finally {
      setLoading(false);
    }
  }, [baseUnitId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openCreateModal = () => {
    setEditingProduct(null);
    setName('');
    setBarcode('');
    setSku('');
    setSkuTouched(false);
    setCategoryId(categories[0]?.id || '');
    setBaseUnitId(units[0]?.id || '');
    setPurchaseCost('');
    setSellingPrice('');
    setOpeningStock('0');
    setMinStockLevel('5');
    setExpiryDate('');
    setDescription('');
    setImagePath(null);
    setProductImageFile(null);
    setImagePreviewUrl(null);
    setShowProductForm(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setBarcode(p.barcode || '');
    setSku(p.sku || '');
    setSkuTouched(Boolean(p.sku));
    setCategoryId(p.category_id || '');
    setBaseUnitId(p.base_unit_id);
    setPurchaseCost(p.purchase_cost !== null ? String(p.purchase_cost) : '');
    setSellingPrice(String(p.selling_price));
    setMinStockLevel(String(p.min_stock_level));
    setExpiryDate(p.expiry_date || '');
    setDescription(p.description || '');
    setImagePath(p.image_path || null);
    setProductImageFile(null);
    setImagePreviewUrl(null);
    if (p.image_path && supabase) {
      supabase.storage
        .from('product-images')
        .createSignedUrl(p.image_path, 3600)
        .then(({ data }) => {
          if (data?.signedUrl) setImagePreviewUrl(data.signedUrl);
        });
    }
    setShowProductForm(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    try {
      if (editingProduct) {
        const { error: updErr } = await supabase
          .from('products')
          .update({
            name: name.trim(),
            barcode: barcode.trim() || null,
            sku: sku.trim() || null,
            category_id: categoryId || null,
            base_unit_id: baseUnitId,
            purchase_cost: purchaseCost !== '' ? Number(purchaseCost) : null,
            selling_price: Number(sellingPrice),
            min_stock_level: Number(minStockLevel),
            expiry_date: expiryDate || null,
            description: description.trim() || null,
          })
          .eq('id', editingProduct.id);
        if (updErr) throw updErr;
        if (productImageFile && editingProduct && supabase) {
          setUploadingImage(true);
          const uploadPath = `${editingProduct.id}/${Date.now()}-${productImageFile.name}`;
          const { error: upErr } = await supabase.storage.from('product-images').upload(uploadPath, productImageFile, { upsert: true });
          if (upErr) throw upErr;
          await supabase.from('products').update({ image_path: uploadPath }).eq('id', editingProduct.id);
          setImagePath(uploadPath);
        }
      } else {
        const { data: created, error: insErr } = await supabase
          .from('products')
          .insert({
            name: name.trim(),
            barcode: barcode.trim() || null,
            sku: sku.trim() || null,
            category_id: categoryId || null,
            base_unit_id: baseUnitId,
            purchase_cost: purchaseCost !== '' ? Number(purchaseCost) : null,
            selling_price: Number(sellingPrice),
            stock_quantity: 0,
            min_stock_level: Number(minStockLevel),
            expiry_date: expiryDate || null,
            description: description.trim() || null,
          })
          .select('id')
          .single();
        if (insErr) throw insErr;

        const initQty = Number(openingStock || 0);
        if (initQty > 0 && created) {
          const { data: sessionData } = await supabase.auth.getSession();
          const ownerId = sessionData.session?.user?.id;
          if (ownerId) {
            await supabase.rpc('fn_record_stock_adjustment', {
              p_product_id: created.id,
              p_owner_id: ownerId,
              p_movement_type: 'opening_stock',
              p_quantity_delta: initQty,
              p_description: 'Initial opening stock upon product registration',
            });
          }
        }
        if (productImageFile && created && supabase) {
          setUploadingImage(true);
          const uploadPath = `${created.id}/${Date.now()}-${productImageFile.name}`;
          const { error: upErr } = await supabase.storage.from('product-images').upload(uploadPath, productImageFile, { upsert: true });
          if (upErr) throw upErr;
          await supabase.from('products').update({ image_path: uploadPath }).eq('id', created.id);
          setImagePath(uploadPath);
        }
      }
      setShowProductForm(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    }
  };

  const handleToggleArchive = async (p: Product) => {
    if (!supabase) return;
    await supabase.from('products').update({ is_archived: !p.is_archived }).eq('id', p.id);
    await loadAll();
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !newCategoryName.trim()) return;
    const { error: catErr } = await supabase.from('categories').insert({ name: newCategoryName.trim() });
    if (catErr) {
      setError(catErr.message);
      return;
    }
    setNewCategoryName('');
    await loadAll();
  };

  const handleAddConversion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !convModalProduct) return;
    const { error: cErr } = await supabase.from('product_unit_conversions').insert({
      product_id: convModalProduct.id,
      unit_name: convUnitName.trim(),
      unit_code: convUnitCode.trim() || convUnitName.trim().toLowerCase(),
      conversion_to_base: Number(convFactor),
      selling_price: convPrice !== '' ? Number(convPrice) : null,
      is_purchase_unit: convIsPurchase,
      is_sale_unit: convIsSale,
    });
    if (cErr) {
      setError(cErr.message);
      return;
    }
    setConvUnitName('');
    setConvUnitCode('');
    setConvFactor('');
    setConvPrice('');
    await loadAll();
    setConvModalProduct(null);
  };

  const handleDeleteConversion = async (convId: string) => {
    if (!supabase) return;
    await supabase.from('product_unit_conversions').delete().eq('id', convId);
    await loadAll();
    setConvModalProduct(null);
  };

  const handleStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !adjModalProduct) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const ownerId = sessionData.session?.user?.id;
    if (!ownerId) return;

    const delta = Number(adjDelta);
    const { error: rpcErr } = await supabase.rpc('fn_record_stock_adjustment', {
      p_product_id: adjModalProduct.id,
      p_owner_id: ownerId,
      p_movement_type: adjType,
      p_quantity_delta: adjType === 'damaged_stock' || adjType === 'expired_stock' ? -Math.abs(delta) : delta,
      p_description: adjReason.trim(),
    });
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setAdjModalProduct(null);
    setAdjDelta('');
    setAdjReason('');
    await loadAll();
  };

  const visibleProducts = products.filter((p) => {
    if (!showArchived && p.is_archived) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1F2937]">Products & Smart Stock Units</h1>
          <p className="text-xs text-[#6B7280]">
            Manage inventory, barcodes, base measurement units, and pack/weight/volume conversions
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-lg bg-[#E60000] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#cc0000] cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Add Product
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Search & Category Quick Add */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 rounded-xl bg-white border border-[#E5E7EB] p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product name, barcode, or SKU..."
              className="w-full rounded-lg border border-[#E5E7EB] pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-[#E60000]"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-[#4B5563] cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-[#E60000]"
            />
            Show Archived
          </label>
        </div>

        <form onSubmit={handleAddCategory} className="lg:col-span-5 rounded-xl bg-white border border-[#E5E7EB] p-3 flex gap-2">
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New category name (e.g. Cooking Oil)..."
            className="flex-1 rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs focus:outline-none focus:border-[#E60000]"
          />
          <button
            type="submit"
            className="rounded-lg bg-[#1F2937] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#111827] whitespace-nowrap cursor-pointer"
          >
            Add Category
          </button>
        </form>
      </div>

      {/* Product Table */}
      <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-xs text-[#6B7280]">Loading products...</p>
        ) : visibleProducts.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-bold text-[#1F2937]">No products registered yet</p>
            <p className="text-xs text-[#6B7280] mt-1">Create your first product to track stock and start selling.</p>
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#E60000] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              <Plus className="h-4 w-4" /> Register First Product
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-[#6B7280]">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Product</th>
                  <th className="text-left px-4 py-3 font-semibold">Category</th>
                  <th className="text-right px-4 py-3 font-semibold">Cost</th>
                  <th className="text-right px-4 py-3 font-semibold">Price</th>
                  <th className="text-right px-4 py-3 font-semibold">Stock</th>
                  <th className="text-left px-4 py-3 font-semibold">Conversions</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {visibleProducts.map((p) => {
                  const alert = evaluateStockAlert(Number(p.stock_quantity), Number(p.min_stock_level), p.expiry_date);
                  return (
                    <tr key={p.id} className={p.is_archived ? 'bg-[#F9FAFB] opacity-60' : 'hover:bg-[#F9FAFB]'}>
                      <td className="px-4 py-3">
                        <p className="font-bold text-[#1F2937]">{p.name}</p>
                        <p className="text-[11px] text-[#6B7280] font-mono">
                          {p.barcode || 'No barcode'} {p.expiry_date ? `· Exp ${p.expiry_date}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-[#4B5563]">{p.categories?.name || 'Uncategorized'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#6B7280]">
                        {p.purchase_cost !== null ? formatGHS(Number(p.purchase_cost)) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatGHS(Number(p.selling_price))} / {p.measurement_units?.code}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span
                          className={`font-bold ${
                            alert.stockLevel === 'out_of_stock'
                              ? 'text-[#E60000]'
                              : alert.stockLevel === 'low_stock'
                              ? 'text-amber-600'
                              : 'text-[#1F2937]'
                          }`}
                        >
                          {Number(p.stock_quantity).toFixed(2).replace(/\.00$/, '')} {p.measurement_units?.code}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setConvModalProduct(p)}
                          className="inline-flex items-center gap-1 rounded border border-[#E5E7EB] px-2 py-1 text-[11px] font-semibold hover:bg-[#F3F4F6] cursor-pointer"
                        >
                          <Scale className="h-3 w-3 text-[#E60000]" />
                          {p.product_unit_conversions?.length || 0} units
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setAdjModalProduct(p)}
                          className="inline-flex items-center gap-1 text-[#1F2937] hover:text-[#E60000] font-semibold cursor-pointer"
                        >
                          <SlidersHorizontal className="h-3 w-3" /> Adjust
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          className="font-semibold text-blue-700 hover:underline cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleArchive(p)}
                          className="inline-flex items-center gap-1 text-[#6B7280] hover:text-[#1F2937] cursor-pointer"
                        >
                          <Archive className="h-3 w-3" /> {p.is_archived ? 'Restore' : 'Archive'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Product Modal */}
      {showProductForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl bg-white border border-[#E5E7EB] p-5">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
              <h3 className="font-display text-base font-bold">
                {editingProduct ? 'Edit Product' : 'Register New Product'}
              </h3>
              <button type="button" onClick={() => setShowProductForm(false)} className="p-1 text-[#6B7280]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveProduct} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Product Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setName(nextName);
                    if (!skuTouched) {
                      setSku(
                        nextName
                          .trim()
                          .toUpperCase()
                          .replace(/[^A-Z0-9]+/g, '-')
                          .replace(/^-+|-+$/g, '')
                          .slice(0, 24)
                      );
                    }
                  }}
                  placeholder="e.g. Frytol Vegetable Oil (Litres)"
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Barcode</label>
                  <input
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">SKU</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => {
                      setSku(e.target.value);
                      setSkuTouched(true);
                    }}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Category</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Base Measurement Unit</label>
                  <select
                    required
                    value={baseUnitId}
                    onChange={(e) => setBaseUnitId(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm bg-white"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Purchase Cost / Base Unit (GH₵)</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={purchaseCost}
                    onChange={(e) => setPurchaseCost(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Selling Price / Base Unit (GH₵)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {!editingProduct && (
                  <div>
                    <label className="block font-semibold mb-1">Opening Stock</label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={openingStock}
                      onChange={(e) => setOpeningStock(e.target.value)}
                      className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm tabular-nums"
                    />
                  </div>
                )}
                <div>
                  <label className="block font-semibold mb-1">Min Stock Alert</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={minStockLevel}
                    onChange={(e) => setMinStockLevel(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Expiry Date</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => document.getElementById('product-image-input')?.click()}
                      className="shrink-0 rounded-lg bg-[#E60000] px-3 py-2 text-xs font-semibold text-white hover:bg-[#cc0000] cursor-pointer"
                      disabled={uploadingImage}
                    >
                      {uploadingImage ? 'Uploading...' : 'Product Image'}
                    </button>
                  </div>
                  <input
                    id="product-image-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setProductImageFile(file);
                        setImagePreviewUrl(URL.createObjectURL(file));
                      }
                    }}
                  />
                  {imagePreviewUrl && (
                    <img src={imagePreviewUrl} alt="Product" className="mt-2 h-20 w-20 rounded-lg object-cover border border-[#E5E7EB]" />
                  )}
                </div>
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-[#E60000] py-2.5 text-sm font-semibold text-white hover:bg-[#cc0000] cursor-pointer"
              >
                {editingProduct ? 'Save Product Changes' : 'Create Product'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Smart Unit Conversions Modal */}
      {convModalProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-2">
              <div>
                <h3 className="font-display text-base font-bold">Unit Conversions — {convModalProduct.name}</h3>
                <p className="text-[11px] text-[#6B7280]">Base unit: {convModalProduct.measurement_units?.name} ({convModalProduct.measurement_units?.code})</p>
              </div>
              <button type="button" onClick={() => setConvModalProduct(null)} className="p-1 text-[#6B7280]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5 text-xs max-h-40 overflow-y-auto">
              {(convModalProduct.product_unit_conversions || []).length === 0 ? (
                <p className="text-[#6B7280]">No conversions added (e.g., 500 ml = 0.5 L, or Carton = 24 pcs).</p>
              ) : (
                convModalProduct.product_unit_conversions?.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-[#E5E7EB] px-3 py-2">
                    <div>
                      <span className="font-bold">{c.unit_name}</span>
                      <span className="text-[#6B7280] ml-2 tabular-nums">
                        = {c.conversion_to_base} {convModalProduct.measurement_units?.code}
                      </span>
                      {c.selling_price !== null && (
                        <span className="ml-2 text-[#E60000] font-semibold tabular-nums">{formatGHS(Number(c.selling_price))}</span>
                      )}
                    </div>
                    <button type="button" onClick={() => handleDeleteConversion(c.id)} className="text-[#E60000] font-semibold">
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleAddConversion} className="space-y-2.5 border-t border-[#E5E7EB] pt-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={convUnitName}
                  onChange={(e) => setConvUnitName(e.target.value)}
                  placeholder="Unit name (e.g. 500 ml / Carton)"
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2"
                />
                <input
                  type="text"
                  value={convUnitCode}
                  onChange={(e) => setConvUnitCode(e.target.value)}
                  placeholder="Short code (e.g. 500ml)"
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.000001"
                  min="0.000001"
                  required
                  value={convFactor}
                  onChange={(e) => setConvFactor(e.target.value)}
                  placeholder={`Base factor (e.g. 0.5)`}
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2 tabular-nums"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={convPrice}
                  onChange={(e) => setConvPrice(e.target.value)}
                  placeholder="Selling price (optional)"
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2 tabular-nums"
                />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={convIsSale} onChange={(e) => setConvIsSale(e.target.checked)} className="accent-[#E60000]" />
                  Sale Unit
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={convIsPurchase} onChange={(e) => setConvIsPurchase(e.target.checked)} className="accent-[#E60000]" />
                  Purchase Unit
                </label>
              </div>
              <button type="submit" className="w-full rounded-lg bg-[#E60000] py-2 font-semibold text-white">
                Add Conversion Rule
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjModalProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-2">
              <h3 className="font-display text-base font-bold">Adjust Stock — {adjModalProduct.name}</h3>
              <button type="button" onClick={() => setAdjModalProduct(null)} className="p-1 text-[#6B7280]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleStockAdjustment} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Movement Classification</label>
                <select
                  value={adjType}
                  onChange={(e) => setAdjType(e.target.value as any)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 bg-white"
                >
                  <option value="stock_adjustment">Authorized Stock Adjustment (+/-)</option>
                  <option value="damaged_stock">Damaged Stock (Deduct)</option>
                  <option value="expired_stock">Expired Stock (Deduct)</option>
                  <option value="opening_stock">Opening Stock Correction (+)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">
                  Quantity ({adjModalProduct.measurement_units?.code})
                </label>
                <input
                  type="number"
                  step="0.0001"
                  required
                  value={adjDelta}
                  onChange={(e) => setAdjDelta(e.target.value)}
                  placeholder="e.g. -2 or +5"
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Reason / Audit Description</label>
                <input
                  type="text"
                  required
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="Explain adjustment for Storebook ledger"
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
                />
              </div>
              <button type="submit" className="w-full rounded-lg bg-[#E60000] py-2.5 text-sm font-semibold text-white">
                Record Storebook Adjustment
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
