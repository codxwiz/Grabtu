import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Category, MenuItem } from "./types";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const MAX_IMAGE_BYTES = 3_000_000;

type Props = {
  categories: Category[];
  canManage: boolean;
  onAddCategory: (data: { name: string; sortOrder: number }) => Promise<boolean>;
  onSaveItem: (data: Partial<MenuItem> & { categoryId: string; name: string; price: number }) => Promise<boolean>;
  onDeleteItem: (item: MenuItem) => Promise<boolean>;
  onSaveOption: (itemId: string, data: { name: string; priceDelta: number; isAvailable: boolean }) => Promise<boolean>;
  onUpload: (kind: "menu-item", file: File) => Promise<string | null>;
};

export function MenuPage({ categories, canManage, onAddCategory, onSaveItem, onDeleteItem, onSaveOption, onUpload }: Props) {
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const imageUrlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  async function categorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("category");
    setError("");
    try {
      const saved = await onAddCategory({ name: String(data.get("name")).trim(), sortOrder: categories.length + 1 });
      if (saved) {
        form.reset();
        setMessage("Category added.");
      }
    } finally {
      setBusy("");
    }
  }

  async function itemSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy("item");
    setError("");
    try {
      const saved = await onSaveItem({
        ...(editing ? { id: editing.id } : {}),
        categoryId: String(data.get("categoryId")),
        name: String(data.get("name")).trim(),
        description: String(data.get("description")).trim(),
        price: Number(data.get("price")),
        imageUrl: String(data.get("imageUrl") || ""),
        prepMinutes: Number(data.get("prepMinutes") || 15),
        hsnCode: String(data.get("hsnCode") || "") || undefined,
        gstRate: String(data.get("gstRate") || "") === "" ? undefined : Number(data.get("gstRate")),
        isVeg: data.get("isVeg") === "on",
        isAvailable: data.get("outOfStock") !== "on",
        tags: String(data.get("tags") || "").split(",").map(tag => tag.trim()).filter(Boolean),
      });
      if (saved) {
        setEditing(null);
        setMessage("Menu item saved.");
      }
    } finally {
      setBusy("");
    }
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Choose an image smaller than 3 MB.");
      event.target.value = "";
      return;
    }
    setBusy("upload");
    setError("");
    try {
      const url = await onUpload("menu-item", file);
      if (url && imageUrlRef.current) {
        imageUrlRef.current.value = url;
        setMessage("Food photo uploaded. Save the item to publish it.");
      }
    } finally {
      setBusy("");
      event.target.value = "";
    }
  }

  async function optionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("option");
    try {
      const saved = await onSaveOption(editing.id, { name: String(data.get("optionName")).trim(), priceDelta: Number(data.get("priceDelta")), isAvailable: true });
      if (saved) {
        form.reset();
        setMessage("Add-on added.");
      }
    } finally {
      setBusy("");
    }
  }

  function deleteItem(item: MenuItem) {
    if (window.confirm(`Delete ${item.name}? Existing order history will be preserved.`)) void onDeleteItem(item);
  }

  return <div className={`menu-layout ${canManage ? "" : "read-only-workspace"}`}>
    <section className="menu-list" aria-label="Menu items">
      {canManage && <form className="inline-form" onSubmit={categorySubmit}>
        <label className="sr-only" htmlFor="new-category-name">Category name</label>
        <input id="new-category-name" name="name" placeholder="New category name" required minLength={2} maxLength={60} />
        <button disabled={Boolean(busy)}>{busy === "category" ? "Adding…" : "Add category"}</button>
      </form>}
      {!canManage && <div className="read-only-notice" role="note"><b>Read-only menu</b><span>Your role can view the current menu. An owner, manager, or supervisor can make changes.</span></div>}
      {message && <div className="toast-inline" role="status">{message}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {categories.length === 0 ? <div className="empty-state"><b>{canManage ? "Build your first menu" : "No menu items yet"}</b><p>{canManage ? "Create a category such as Popular or Drinks, then add dishes with photos and preparation times." : "The restaurant menu has not been published yet."}</p></div> : categories.map(category => <div className="menu-category" key={category.id}>
        <h2>{category.name}<span>{category.items.length} items</span></h2>
        {category.items.length === 0 && <p className="empty-inline">No items in this category yet.</p>}
        {category.items.map(item => <article className={!item.isAvailable ? "unavailable" : ""} key={item.id}>
          {item.imageUrl ? <img className="menu-thumb" src={item.imageUrl} alt={`${item.name} menu item`} loading="lazy" decoding="async" /> : <div className="menu-thumb placeholder-photo" aria-hidden="true">Photo</div>}
          <div><b>{item.name}</b>{!item.isAvailable && <span className="stock-status">Out of stock</span>}<p>{item.description}</p><strong>{money(item.price)}</strong><small>{item.prepMinutes || 15} min{item.gstRate != null ? ` · GST ${item.gstRate}%` : ""}{item.hsnCode ? ` · HSN ${item.hsnCode}` : ""}</small>{(Array.isArray(item.options) ? item.options : []).map(option => <small key={option.id}>{option.name}{option.priceDelta ? ` · ${option.priceDelta > 0 ? "+" : ""}${money(option.priceDelta)}` : ""}</small>)}</div>
          {canManage && <div className="menu-item-actions"><button type="button" className="availability" onClick={() => setEditing(item)}>Edit</button><button type="button" className="danger-action" onClick={() => deleteItem(item)}>Delete</button></div>}
        </article>)}
      </div>)}
    </section>

    {canManage && (categories.length ? <div className="item-form"><form key={editing?.id || "new-item"} onSubmit={itemSubmit}>
      <h2>{editing ? "Edit item" : "Add menu item"}</h2><p className="form-help">Use a bright food photo and a realistic kitchen estimate.</p>
      <label>Category<select name="categoryId" defaultValue={editing?.categoryId || categories[0]?.id} required>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
      <label>Name<input name="name" defaultValue={editing?.name} required minLength={2} maxLength={100} /></label>
      <label>Description<textarea name="description" defaultValue={editing?.description} rows={3} maxLength={300} /></label>
      <label>Food photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={Boolean(busy)} /><small>PNG, JPG, or WebP · maximum 3 MB</small></label>
      <label>Uploaded image URL<input ref={imageUrlRef} name="imageUrl" type="url" defaultValue={editing?.imageUrl} placeholder="Uploaded image URL" /></label>
      <label>Price (₹)<input name="price" type="number" defaultValue={editing?.price} min="1" max="1000000" step="1" inputMode="numeric" required /></label>
      <div className="form-row"><label>HSN/SAC code<input name="hsnCode" inputMode="numeric" pattern="[0-9]{4,8}" defaultValue={editing?.hsnCode || ""} placeholder="Optional" /></label><label>GST rate %<input name="gstRate" type="number" min="0" max="50" step=".01" defaultValue={editing?.gstRate} placeholder="Restaurant default" /></label></div>
      <label>Preparation estimate (minutes)<input name="prepMinutes" type="number" defaultValue={editing?.prepMinutes || 15} min="1" max="180" step="1" inputMode="numeric" required /></label>
      <label>Tags<input name="tags" defaultValue={Array.isArray(editing?.tags) ? editing.tags.join(", ") : ""} placeholder="Bestseller, Spicy" /></label>
      <label className="check"><input name="isVeg" type="checkbox" defaultChecked={editing?.isVeg ?? true} /> Vegetarian</label>
      {editing && <label className="check stock-toggle"><input name="outOfStock" type="checkbox" defaultChecked={!editing.isAvailable} /> Out of stock</label>}
      <button disabled={Boolean(busy)}>{busy === "item" ? "Saving…" : editing ? "Save changes" : "Add item"}</button>
      {editing && <button type="button" className="secondary-action" onClick={() => setEditing(null)} disabled={Boolean(busy)}>Cancel</button>}
    </form>
    {editing && <form className="option-form" onSubmit={optionSubmit}><h3>Add-on option</h3><label className="sr-only" htmlFor="option-name">Option name</label><input id="option-name" name="optionName" placeholder="Extra cheese" required minLength={1} maxLength={60} /><label className="sr-only" htmlFor="option-price">Price adjustment</label><input id="option-price" name="priceDelta" type="number" placeholder="Price adjustment" defaultValue="0" min="-100000" max="100000" step="1" /><button disabled={Boolean(busy)}>{busy === "option" ? "Adding…" : "Add option"}</button></form>}
    </div> : <aside className="item-form empty-editor"><h2>Add a category first</h2><p>Create at least one category before adding menu items.</p></aside>)}
  </div>;
}
