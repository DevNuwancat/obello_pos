import { defineStore } from "pinia";

// One line in the barcode print queue — a product plus how many labels to print
export interface BarcodeQueueItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  selling_price: number;
  image_url: string | null;
  qty: number;
}

const STORAGE_KEY = "barcode-print-queue";

// Read whatever was saved last time, so a page refresh doesn't lose the queue
function loadFromStorage(): BarcodeQueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export const useBarcodePrintStore = defineStore("barcodePrint", {
  state: () => ({
    queue: loadFromStorage() as BarcodeQueueItem[],
  }),

  getters: {
    totalLabels: (state) => state.queue.reduce((sum, item) => sum + item.qty, 0),
  },

  actions: {
    // Save the current queue to localStorage — called after every change below
    persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    },

    // Add a product to the queue. If it's already queued, just update the qty
    // instead of creating a duplicate row.
    addToQueue(product: { id: string; name: string; sku: string | null; barcode: string | null; selling_price: number; image_url: string | null }, qty?: number) {
      const existing = this.queue.find((i) => i.id === product.id);
      if (existing) {
        existing.qty = qty ?? existing.qty;
      } else {
        this.queue.push({
          id: product.id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          selling_price: product.selling_price,
          image_url: product.image_url,
          qty: qty ?? 1,
        });
      }
      this.persist();
    },

    updateQty(id: string, qty: number) {
      const item = this.queue.find((i) => i.id === id);
      if (!item) return;
      item.qty = Math.max(0, qty);
      this.persist();
    },

    removeFromQueue(id: string) {
      this.queue = this.queue.filter((i) => i.id !== id);
      this.persist();
    },

    clearQueue() {
      this.queue = [];
      this.persist();
    },
  },
});
