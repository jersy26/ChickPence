import { AuthService } from '../services/auth.js';
import { isSupabaseConfigured } from '../services/supabaseClient.js';
import { openSupabaseConfigModal } from './modals.js';
import { showToast } from './toast.js';

export function renderLogin() {
  const isCloud = isSupabaseConfigured();

  return `
    <div class="login-wrapper">
      <div class="card-box login-card">
        <div style="text-align: center; margin-bottom: 8px;">
          <div style="font-size: 40px; margin-bottom: 4px;">🐥</div>
          <h1 style="font-size: 24px;">ChickPence</h1>
          <div class="text-mut" style="margin-top: 4px;">Poultry Cost & Profitability Analysis</div>
        </div>

        <div id="login-error-msg" class="flag-alert" style="display: none;"></div>

        <label class="form-field">
          Email / Username
          <input id="login-email" type="text" placeholder="${isCloud ? 'name@example.com' : 'encoder'}" />
        </label>

        <label class="form-field">
          Password
          <input id="login-password" type="password" placeholder="••••••••" />
        </label>

        <button class="btn-action primary" id="btn-submit-login" style="padding: 10px; margin-top: 6px;">
          Log in
        </button>

        <button class="btn-action accent" id="btn-quick-demo" style="padding: 10px;">
          Instant Demo Mode
        </button>

        <div class="flex-row" style="justify-content: center; margin-top: 6px;">
          <button class="btn-link" id="btn-login-cloud-settings">
            ⚙ ${isCloud ? 'Supabase Connected' : 'Connect Supabase Cloud'}
          </button>
        </div>

        <div class="text-mut" style="text-align: center; font-size: 11px; margin-top: 4px;">
          Thesis Prototype (BSCS, PLM) · Offline-First PWA
        </div>
      </div>
    </div>
  `;
}

export function attachLoginListeners(container, onLoginSuccess) {
  const emailInput = container.querySelector('#login-email');
  const passInput = container.querySelector('#login-password');
  const errorMsg = container.querySelector('#login-error-msg');
  const submitBtn = container.querySelector('#btn-submit-login');
  const demoBtn = container.querySelector('#btn-quick-demo');
  const cloudBtn = container.querySelector('#btn-login-cloud-settings');

  const handleLogin = async (email, password) => {
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in…';
      if (errorMsg) errorMsg.style.display = 'none';

      await AuthService.login(email, password);
      showToast('Logged in successfully');
      onLoginSuccess();
    } catch (err) {
      if (errorMsg) {
        errorMsg.textContent = err.message || 'Login failed. Please check your credentials.';
        errorMsg.style.display = 'flex';
      }
      showToast(err.message || 'Login failed');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log in';
    }
  };

  submitBtn?.addEventListener('click', () => {
    handleLogin(emailInput.value, passInput.value);
  });

  const handleEnter = (e) => {
    if (e.key === 'Enter') {
      handleLogin(emailInput.value, passInput.value);
    }
  };

  emailInput?.addEventListener('keydown', handleEnter);
  passInput?.addEventListener('keydown', handleEnter);

  demoBtn?.addEventListener('click', async () => {
    await AuthService.loginDemo();
    showToast('Logged in as Demo Encoder');
    onLoginSuccess();
  });

  cloudBtn?.addEventListener('click', () => {
    openSupabaseConfigModal();
  });
}
