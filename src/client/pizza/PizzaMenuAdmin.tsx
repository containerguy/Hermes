import { useEffect, useState } from "react";
import { requestJson } from "../api/request";
import type { PizzaCategory, PizzaItem } from "./types";

interface AdminMenuResponse {
  items: PizzaItem[];
}

export function PizzaMenuAdmin() {
  const [items, setItems] = useState<PizzaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const data = await requestJson<AdminMenuResponse>("/api/pizza/admin/menu");
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (loading) return <p className="muted">Pizza-Menü lädt…</p>;

  return (
    <section className="admin-ops pizza-admin" aria-label="Pizza-Menü-Verwaltung">
      <p className="eyebrow">Pizzabestellung</p>
      <h2>Menü-Verwaltung</h2>
      {error ? (
        <p className="pizza-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      <NewItemForm onCreated={reload} />
      <p className="muted">{items.length} Einträge gesamt.</p>
      <ul className="pizza-admin__list">
        {items.map((item) => (
          <PizzaAdminRow key={item.id} item={item} onChanged={reload} />
        ))}
      </ul>
    </section>
  );
}

function NewItemForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [category, setCategory] = useState<PizzaCategory>("pizza");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await requestJson("/api/pizza/admin/items", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          number: number.trim() || null,
          category,
          active: true
        })
      });
      setName("");
      setNumber("");
      await onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="admin-form pizza-admin__new">
      <label>
        Nummer (optional)
        <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={16} />
      </label>
      <label>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
      </label>
      <label>
        Kategorie
        <select value={category} onChange={(e) => setCategory(e.target.value as PizzaCategory)}>
          <option value="pizza">Pizza</option>
          <option value="pasta">Pasta / Auflauf</option>
        </select>
      </label>
      <button type="submit" disabled={busy}>
        Eintrag anlegen
      </button>
    </form>
  );
}

function PizzaAdminRow({
  item,
  onChanged
}: {
  item: PizzaItem;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    number: item.number ?? "",
    name: item.name,
    ingredients: item.ingredients ?? "",
    allergens: item.allergens ?? "",
    category: item.category,
    sortOrder: item.sortOrder
  });
  const [busy, setBusy] = useState(false);
  const dirty =
    draft.number !== (item.number ?? "") ||
    draft.name !== item.name ||
    draft.ingredients !== (item.ingredients ?? "") ||
    draft.allergens !== (item.allergens ?? "") ||
    draft.category !== item.category ||
    draft.sortOrder !== item.sortOrder;

  async function save() {
    setBusy(true);
    try {
      await requestJson("/api/pizza/admin/items", {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          name: draft.name.trim(),
          number: draft.number.trim() || null,
          ingredients: draft.ingredients.trim() || null,
          allergens: draft.allergens.trim() || null,
          category: draft.category,
          sortOrder: draft.sortOrder,
          active: item.active
        })
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await requestJson(`/api/pizza/admin/items/${encodeURIComponent(item.id)}/active`, {
        method: "POST",
        body: JSON.stringify({ active: !item.active })
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`pizza-admin__row${item.active ? "" : " pizza-admin__row--inactive"}`}>
      <div className="pizza-admin__row-grid">
        <label>
          Nr.
          <input
            value={draft.number}
            onChange={(e) => setDraft({ ...draft, number: e.target.value })}
            maxLength={16}
          />
        </label>
        <label>
          Name
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            maxLength={120}
          />
        </label>
        <label>
          Kategorie
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value as PizzaCategory })}
          >
            <option value="pizza">Pizza</option>
            <option value="pasta">Pasta</option>
          </select>
        </label>
        <label>
          Sortierung
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
          />
        </label>
        <label className="pizza-admin__wide">
          Zutaten
          <input
            value={draft.ingredients}
            onChange={(e) => setDraft({ ...draft, ingredients: e.target.value })}
            maxLength={500}
          />
        </label>
        <label>
          Allergene
          <input
            value={draft.allergens}
            onChange={(e) => setDraft({ ...draft, allergens: e.target.value })}
            maxLength={120}
          />
        </label>
      </div>
      <VariantsEditor item={item} onChanged={onChanged} />
      <div className="pizza-admin__row-actions">
        <button type="button" onClick={save} disabled={!dirty || busy}>
          Speichern
        </button>
        <button type="button" className="secondary" onClick={toggleActive} disabled={busy}>
          {item.active ? "Deaktivieren" : "Aktivieren"}
        </button>
      </div>
    </li>
  );
}

function VariantsEditor({
  item,
  onChanged
}: {
  item: PizzaItem;
  onChanged: () => Promise<void>;
}) {
  const [newSize, setNewSize] = useState("");
  const [newPriceCents, setNewPriceCents] = useState("");
  const [busy, setBusy] = useState(false);

  async function deleteVariant(id: string) {
    setBusy(true);
    try {
      await requestJson(`/api/pizza/admin/variants/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function updatePrice(variantId: string, sizeLabel: string | null, priceCents: number) {
    setBusy(true);
    try {
      await requestJson("/api/pizza/admin/variants", {
        method: "POST",
        body: JSON.stringify({
          id: variantId,
          itemId: item.id,
          sizeLabel,
          priceCents
        })
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addVariant(event: React.FormEvent) {
    event.preventDefault();
    const cents = Number(newPriceCents);
    if (!Number.isFinite(cents) || cents < 0) return;
    setBusy(true);
    try {
      await requestJson("/api/pizza/admin/variants", {
        method: "POST",
        body: JSON.stringify({
          itemId: item.id,
          sizeLabel: newSize.trim() || null,
          priceCents: Math.round(cents)
        })
      });
      setNewSize("");
      setNewPriceCents("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pizza-admin__variants">
      <strong>Größen / Preise</strong>
      {item.variants.length === 0 ? (
        <p className="muted">Noch keine Variante. Eintrag wird erst nach Anlegen einer
        Variante bestellbar.</p>
      ) : (
        <ul>
          {item.variants.map((variant) => (
            <li key={variant.id}>
              <input
                defaultValue={variant.sizeLabel ?? ""}
                placeholder="Größe (leer = Standard)"
                onBlur={(e) =>
                  updatePrice(variant.id, e.target.value.trim() || null, variant.priceCents)
                }
              />
              <input
                type="number"
                defaultValue={variant.priceCents}
                onBlur={(e) =>
                  updatePrice(
                    variant.id,
                    variant.sizeLabel,
                    Math.max(0, Math.round(Number(e.target.value)))
                  )
                }
              />{" "}
              ¢
              <button
                type="button"
                className="secondary"
                onClick={() => deleteVariant(variant.id)}
                disabled={busy}
              >
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addVariant} className="pizza-admin__new-variant">
        <input
          value={newSize}
          onChange={(e) => setNewSize(e.target.value)}
          placeholder="Größe (24cm, leer)"
          maxLength={32}
        />
        <input
          type="number"
          value={newPriceCents}
          onChange={(e) => setNewPriceCents(e.target.value)}
          placeholder="Preis in Cent"
          min={0}
        />
        <button type="submit" disabled={busy || !newPriceCents}>
          Variante hinzufügen
        </button>
      </form>
    </div>
  );
}
