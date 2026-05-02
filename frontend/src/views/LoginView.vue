<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'

const router   = useRouter()
const auth     = useAuthStore()

const email    = ref('')
const password = ref('')
const loading  = ref(false)
const errorMsg = ref('')
const showPass = ref(false)
const emailFocused = ref(false)
const passFocused  = ref(false)

async function handleLogin() {
  if (!email.value || !password.value) {
    errorMsg.value = 'Please enter your email and password.'
    return
  }

  loading.value  = true
  errorMsg.value = ''

  try {
    await auth.login(email.value, password.value)
    router.push('/')
  } catch (err: any) {
    errorMsg.value = 'Wrong email or password. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">

    <!-- ── LEFT PANEL ── -->
    <div class="login-left">

      <!-- Brand -->
      <div class="brand-row">
        <div class="brand-mark">Obello</div>
        <div>
          <div class="brand-name"></div>
          <div class="brand-ver">POS v2.0</div>
        </div>
      </div>

      <!-- Hero text -->
      <div class="hero">
        <div class="hero-line">Your store.</div>
        <div class="hero-line muted">Smarter.</div>
        <div class="hero-line">Faster.</div>
      </div>

      <!-- Features -->
      <div class="features">
        <div class="feat">
          <span class="feat-icon">⚡</span>
          <div>
            <div class="feat-title">AI-Powered Insights</div>
            <div class="feat-desc">Gemini agent answers your business questions instantly</div>
          </div>
        </div>
        <div class="feat">
          <span class="feat-icon">📦</span>
          <div>
            <div class="feat-title">Smart Inventory</div>
            <div class="feat-desc">Real-time stock tracking with auto low-stock alerts</div>
          </div>
        </div>
        <div class="feat">
          <span class="feat-icon">🖨️</span>
          <div>
            <div class="feat-title">Instant Receipts</div>
            <div class="feat-desc">Print bills and barcode sheets in one click</div>
          </div>
        </div>
      </div>

      <!-- Role badges -->
      <div>
        <div class="role-list">
          <div class="role-chip active">Admin</div>
          <div class="role-chip">Manager</div>
          <div class="role-chip">Cashier</div>
        </div>
        <div class="role-note">Role-based access control</div>
      </div>

    </div>

    <!-- ── RIGHT PANEL ── -->
    <div class="login-right">
      <div class="form-card">

        <!-- Heading -->
        <div>
          <div class="form-title">Sign in</div>
          <div class="form-sub">Access your Obello dashboard</div>
        </div>

        <!-- Error message -->
        <div v-if="errorMsg" class="error-pill">
          <div class="error-icon">!</div>
          <span>{{ errorMsg }}</span>
        </div>

        <!-- Fields -->
        <div class="fields">

          <!-- Email -->
          <div class="field-wrap" :class="{ focused: emailFocused }">
            <label>Email</label>
            <input
              v-model="email"
              type="email"
              placeholder="you@obello.com"
              @focus="emailFocused = true"
              @blur="emailFocused = false"
              @keyup.enter="handleLogin"
            />
            <div class="field-line"></div>
          </div>

          <!-- Password -->
          <div class="field-wrap" :class="{ focused: passFocused }">
            <label>Password</label>
            <div class="pass-row">
              <input
                v-model="password"
                :type="showPass ? 'text' : 'password'"
                placeholder="••••••••••"
                @focus="passFocused = true"
                @blur="passFocused = false"
                @keyup.enter="handleLogin"
              />
              <button class="eye-btn" @click="showPass = !showPass" type="button">
                {{ showPass ? '🙈' : '👁️' }}
              </button>
            </div>
            <div class="field-line"></div>
          </div>

        </div>

        <!-- Submit button -->
        <button class="submit-btn" :disabled="loading" @click="handleLogin">
          <span v-if="!loading">Sign in to Obello →</span>
          <span v-else class="btn-loading">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </span>
        </button>

        <!-- Badge -->
        <div class="secured">🔒 Secured by Supabase Auth</div>

      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── Base ── */
.login-wrap {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 1fr 1fr;
  font-family: 'DM Sans', sans-serif;
}

/* ── LEFT ── */
.login-left {
  background: #111110;
  border-right: 1px solid rgba(255,255,255,0.07);
  padding: 56px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 40px;
}

/* Brand */
.brand-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  width: 80px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.07);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #F5F2EE;
  flex-shrink: 0;
}

.brand-name {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #F5F2EE;
  letter-spacing: -0.5px;
  line-height: 1.1;
}

.brand-ver {
  font-size: 10px;
  color: #555551;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-top: 2px;
}

/* Hero */
.hero { display: flex; flex-direction: column; gap: 2px; }

.hero-line {
  font-family: 'Space Grotesk', sans-serif;
  font-size: clamp(36px, 4vw, 52px);
  font-weight: 700;
  line-height: 1.08;
  letter-spacing: -1.5px;
  color: #F5F2EE;
}

.hero-line.muted { color: #888884; }

/* Features */
.features { display: flex; flex-direction: column; gap: 10px; }

.feat {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 18px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 12px;
  transition: border-color 0.2s, background 0.2s;
  cursor: default;
}

.feat:hover {
  border-color: rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
}

.feat-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }

.feat-title {
  font-size: 13.5px;
  font-weight: 500;
  color: #F5F2EE;
  margin-bottom: 3px;
}

.feat-desc {
  font-size: 11.5px;
  color: #555551;
  line-height: 1.5;
}

/* Roles */
.role-list { display: flex; gap: 8px; margin-bottom: 8px; }

.role-chip {
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.1);
  color: #555551;
  font-family: monospace;
}

.role-chip.active {
  background: #F5F2EE;
  color: #111110;
  border-color: #F5F2EE;
  font-weight: 600;
}

.role-note { font-size: 11px; color: #555551; letter-spacing: 0.04em; }

/* ── RIGHT ── */
.login-right {
  background: #181817;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 48px;
}

.form-card {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.form-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 38px;
  font-weight: 700;
  letter-spacing: -1.5px;
  color: #F5F2EE;
  line-height: 1;
  margin-bottom: 8px;
}

.form-sub {
  font-size: 12px;
  color: #555551;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* Error */
.error-pill {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.2);
  border-radius: 10px;
  padding: 12px 16px;
  animation: slideDown 0.2s ease;
}

.error-icon {
  width: 20px;
  height: 20px;
  background: #ef4444;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.error-pill span { font-size: 13px; color: #f87171; }

/* Fields */
.fields { display: flex; flex-direction: column; gap: 28px; }

.field-wrap { position: relative; }

.field-wrap label {
  display: block;
  font-size: 10px;
  font-weight: 500;
  color: #555551;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 10px;
  transition: color 0.2s;
}

.field-wrap.focused label { color: #F5F2EE; }

.field-wrap input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-size: 15px;
  font-family: 'DM Sans', sans-serif;
  font-weight: 500;
  color: #F5F2EE;
  padding: 0 0 12px 0;
  caret-color: #F5F2EE;
  /* kill browser autofill box */
  box-shadow: 0 0 0 30px #181817 inset !important;
  -webkit-box-shadow: 0 0 0 30px #181817 inset !important;
  -webkit-text-fill-color: #F5F2EE !important;
}

.field-wrap input::placeholder { color: #555551; }

.pass-row { display: flex; align-items: flex-end; gap: 8px; }
.pass-row input { flex: 1; }

.eye-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 15px;
  padding: 0 0 12px 0;
  opacity: 0.4;
  transition: opacity 0.2s;
}
.eye-btn:hover { opacity: 1; }

.field-line {
  height: 1px;
  background: #1f1f1e;
  position: relative;
  overflow: hidden;
}

.field-line::after {
  content: '';
  position: absolute;
  inset: 0;
  background: #F5F2EE;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.3s ease;
}

.field-wrap.focused .field-line::after { transform: scaleX(1); }

/* Submit button */
.submit-btn {
  width: 100%;
  height: 56px;
  background: #F5F2EE;
  color: #111110;
  border: none;
  border-radius: 14px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: -0.3px;
  transition: transform 0.15s, opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.submit-btn:hover   { transform: translateY(-2px); opacity: 0.9; }
.submit-btn:active  { transform: translateY(0); }
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

/* Loading dots */
.btn-loading { display: flex; align-items: center; gap: 5px; }

.dot {
  width: 6px;
  height: 6px;
  background: #111110;
  border-radius: 50%;
  animation: blink 1.2s ease-in-out infinite;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

/* Secured badge */
.secured {
  text-align: center;
  font-size: 11px;
  color: #555551;
  letter-spacing: 0.04em;
}

/* Animations */
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
  40%           { opacity: 1;   transform: scale(1); }
}

/* Mobile */
@media (max-width: 768px) {
  .login-wrap { grid-template-columns: 1fr; }
  .login-left { display: none; }
  .login-right { padding: 40px 28px; }
}
</style>
