<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import Slidebar from "../components/Slidebar.vue";
import SupplierModal from "../components/modals/SupplierModal.vue";
import ViewSuppliersModal from "../components/modals/ViewSuppliersModal.vue";
import CategoryModal from "../components/modals/CategoryModal.vue";
import ViewCategoriesModal from "../components/modals/ViewCategoriesModal.vue";
import AddClothModal from "../components/modals/AddClothModal.vue";
import SizeGroupModal from "../components/modals/SizeGroupModal.vue";
import ViewSizeGroupsModal from "../components/modals/ViewSizeGroupsModal.vue";
import OwnerModal from "../components/modals/OwnerModal.vue";
import ViewOwnersModal from "../components/modals/ViewOwnersModal.vue";

const router = useRouter();

// ── THEME ──
// We read from localStorage so the theme stays the same when you switch pages
const isLight = ref(localStorage.getItem("theme") === "light");

// ── SECTION ROWS ──
// Each object is one row on the page: an icon colour, a title, and a description
const sections = [
  {
    key: "cloth-products",
    label: "Cloths Products & Other Accessories",
    description: "Add new clothing items & other accessories to your inventory",
    color: "#808080",
    icon: '<i class="fa-solid fa-shirt"></i>',
  },
  {
    key: "main-categories",
    label: "Main Categories",
    description: "Create and manage your main product categories",
    color: "#808080",
    icon: '<i class="fa-solid fa-layer-group"></i>',
  },
  {
    key: "sizes",
    label: "Sizes",
    description: "Create reusable size groups for your products",
    color: "#808080",
    icon: '<i class="fa-solid fa-ruler"></i>',
  },
  {
    key: "owners",
    label: "Owners",
    description: "Add new owners and view them",
    color: "#808080",
    icon: '<i class="fa-solid fa-user-tie"></i>',
  },
  {
    key: "supplier",
    label: "Supplier",
    description: "Add new supplier and view them",
    color: "#808080",
    icon: '<i class="fa-solid fa-user"></i>',
  },
];

// ── MODAL STATE ──
// activeModal holds which section is currently open ("supplier", "cloth-products", etc.)
// null means no modal is open
const activeModal = ref<string | null>(null);

function openModal(key: string) {
  activeModal.value = key;
}

// showSupplierModal is true when the supplier card was clicked
// Setting it to false closes the modal (sets activeModal back to null)
const showSupplierModal = computed({
  get: () => activeModal.value === "supplier",
  set: (val) => {
    if (!val) activeModal.value = null;
  },
});

const showViewSuppliersModal = computed({
  get: () => activeModal.value === "view-supplier",
  set: (val) => {
    if (!val) activeModal.value = null;
  },
});

const showCategoryModal = computed({
  get: () => activeModal.value === "main-categories",
  set: (val) => {
    if (!val) activeModal.value = null;
  },
});

const showViewCategoriesModal = computed({
  get: () => activeModal.value === "view-main-categories",
  set: (val) => {
    if (!val) activeModal.value = null;
  },
});

const showAddClothModal = computed({
  get: () => activeModal.value === "cloth-products",
  set: (val) => {
    if (!val) activeModal.value = null;
  },
});

const showSizeGroupModal = computed({
  get: () => activeModal.value === "sizes",
  set: (val) => {
    if (!val) activeModal.value = null;
  },
});

const showViewSizeGroupsModal = computed({
  get: () => activeModal.value === "view-sizes",
  set: (val) => {
    if (!val) activeModal.value = null;
  },
});

const showOwnerModal = computed({
  get: () => activeModal.value === "owners",
  set: (val) => {
    if (!val) activeModal.value = null;
  },
});

const showViewOwnersModal = computed({
  get: () => activeModal.value === "view-owners",
  set: (val) => {
    if (!val) activeModal.value = null;
  },
});
</script>

<template>
  <div class="page-wrap" :class="{ light: isLight }">
    <!-- ── SIDEBAR ── -->
    <Slidebar v-model:isLight="isLight" />

    <!-- ── MAIN CONTENT ── -->
    <main class="main">
      <!-- Header -->
      <div class="main-header">
        <div class="main-title">Add New</div>
        <div class="header-sub">Manage your store data</div>
      </div>

      <!-- Section list -->
      <div class="sections-area">
        <div v-for="section in sections" :key="section.key" class="section-row">
          <!-- Icon box on the left -->
          <div
            class="section-icon"
            :style="{
              background: section.color + '22',
              border: '1px solid ' + section.color + '44',
            }"
          >
            <!-- The dot inside the icon box matches the section colour -->
            <div v-html="section.icon"></div>
          </div>

          <!-- Text: title and description -->
          <div class="section-info">
            <div class="section-label">{{ section.label }}</div>
            <div class="section-desc">{{ section.description }}</div>
          </div>

          <!-- Action buttons on the right -->
          <div class="section-actions">
            <button
              v-if="section.key === 'supplier'"
              class="btn-view"
              @click="openModal('view-supplier')"
            >
              <i class="fa-regular fa-eye"></i> View
            </button>
            <button
              v-else-if="section.key === 'main-categories'"
              class="btn-view"
              @click="openModal('view-main-categories')"
            >
              <i class="fa-regular fa-eye"></i> View
            </button>
            <button
              v-else-if="section.key === 'cloth-products'"
              class="btn-view"
              @click="router.push('/product-list')"
            >
              <i class="fa-regular fa-eye"></i> View
            </button>
            <button
              v-else-if="section.key === 'sizes'"
              class="btn-view"
              @click="openModal('view-sizes')"
            >
              <i class="fa-regular fa-eye"></i> View
            </button>
            <button
              v-else-if="section.key === 'owners'"
              class="btn-view"
              @click="openModal('view-owners')"
            >
              <i class="fa-regular fa-eye"></i> View
            </button>
            <button class="btn-add" @click="openModal(section.key)">
              + Add New
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- ── SUPPLIER MODALS ── -->
    <SupplierModal v-model="showSupplierModal" :isLight="isLight" />
    <ViewSuppliersModal v-model="showViewSuppliersModal" :isLight="isLight" />
    <CategoryModal v-model="showCategoryModal" :isLight="isLight" />
    <ViewCategoriesModal v-model="showViewCategoriesModal" :isLight="isLight" />
    <AddClothModal v-model="showAddClothModal" :isLight="isLight" />
    <SizeGroupModal v-model="showSizeGroupModal" :isLight="isLight" />
    <ViewSizeGroupsModal v-model="showViewSizeGroupsModal" :isLight="isLight" />
    <OwnerModal v-model="showOwnerModal" :isLight="isLight" />
    <ViewOwnersModal v-model="showViewOwnersModal" :isLight="isLight" />
  </div>
</template>

<style scoped>
/* ── CSS VARIABLES (dark default) ──
   These are the same colours used across the whole app so everything looks consistent */
.page-wrap {
  --bg: #111110;
  --bg-panel: #181817;
  --bg-card: #1f1f1e;
  --bg-hover: #252524;
  --border: rgba(255, 255, 255, 0.07);
  --border-mid: rgba(255, 255, 255, 0.12);
  --text: #f5f2ee;
  --text-sub: #888884;
  --text-muted: #555551;
  --accent-bg: #f5f2ee;
  --accent-text: #111110;
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.6);
}

/* ── LIGHT THEME OVERRIDES ── */
.page-wrap.light {
  --bg: #f7f5f2;
  --bg-panel: #ffffff;
  --bg-card: #fafaf8;
  --bg-hover: #f0ede9;
  --border: rgba(0, 0, 0, 0.07);
  --border-mid: rgba(0, 0, 0, 0.12);
  --text: #141412;
  --text-sub: #7a776f;
  --text-muted: #b0ada5;
  --accent-bg: #141412;
  --accent-text: #f7f5f2;
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.1);
}

/* ── RESET ── */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* ── FULL-PAGE LAYOUT ── */
.page-wrap {
  display: flex;
  height: 100vh;
  width: 100vw;
  background: var(--bg);
  color: var(--text);
  font-family: "DM Sans", sans-serif;
  overflow: hidden;
  transition:
    background 0.3s,
    color 0.3s;
}

/* ── MAIN AREA ── */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* ── PAGE HEADER ── */
.main-header {
  padding: 28px 40px 24px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.main-title {
  font-family: "Space Grotesk", sans-serif;
  font-weight: 600;
  font-size: 22px;
  letter-spacing: -0.5px;
  color: var(--text);
  line-height: 1.2;
}

.header-sub {
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* ── SECTIONS LIST ── */
.sections-area {
  flex: 1;
  padding: 28px 40px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

/* ── ONE SECTION ROW ── */
.section-row {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 24px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.section-row:hover {
  border-color: var(--border-mid);
  background: var(--bg-hover);
}

/* ── ICON BOX ── */
.section-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* ── TEXT ── */
.section-info {
  flex: 1;
  min-width: 0;
}

.section-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.2px;
}

.section-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 3px;
}

/* ── BUTTONS ── */
.section-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* "View" button — dark/subtle */
.btn-view {
  padding: 8px 18px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-sub);
  font-size: 12.5px;
  font-family: "DM Sans", sans-serif;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}

.btn-view:hover {
  background: var(--bg-hover);
  color: var(--text);
}

/* "Add New" button — light/accent */
.btn-add {
  padding: 8px 18px;
  border-radius: 8px;
  border: none;
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 12.5px;
  font-weight: 600;
  font-family: "DM Sans", sans-serif;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-add:hover {
  opacity: 0.85;
}

/* ── MODAL OVERLAY ──
   This is the dark background behind the modal popup */
.modal-overlay {
  position: fixed;
  inset: 0; /* covers the whole screen */
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

/* ── MODAL BOX ── */
.modal-box {
  width: 420px;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border);
}

.modal-title {
  font-family: "Space Grotesk", sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: var(--text);
}

.modal-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition:
    color 0.15s,
    background 0.15s;
}

.modal-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.modal-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.form-input {
  padding: 11px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text);
  font-size: 13.5px;
  font-family: "DM Sans", sans-serif;
  outline: none;
  transition: border-color 0.15s;
}

.form-input::placeholder {
  color: var(--text-muted);
}
.form-input:focus {
  border-color: var(--border-mid);
}

.modal-footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid var(--border);
}

.modal-cancel {
  padding: 10px 20px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-sub);
  font-size: 13px;
  font-family: "DM Sans", sans-serif;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}

.modal-cancel:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.modal-save {
  padding: 10px 24px;
  border-radius: 9px;
  border: none;
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 13px;
  font-weight: 600;
  font-family: "DM Sans", sans-serif;
  cursor: pointer;
  transition: opacity 0.15s;
}

.modal-save:hover {
  opacity: 0.85;
}

/* ── FADE TRANSITION for the modal ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ── SCROLLBAR ── */
::-webkit-scrollbar {
  width: 4px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.2);
  border-radius: 2px;
}
</style>
