const screens = [...document.querySelectorAll('[data-screen]')];
const routeButtons = [...document.querySelectorAll('[data-route]')];
const navButtons = [...document.querySelectorAll('.nav-item, .bottom-nav button')];
const toast = document.querySelector('.toast');
const authConfig = window.MOMENT_CONFIG || {};
const authConfigured = Boolean(authConfig.supabaseUrl && authConfig.supabasePublishableKey && !authConfig.supabaseUrl.includes('YOUR_'));
const supabaseClient = authConfigured
  ? window.supabase.createClient(authConfig.supabaseUrl, authConfig.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function route(name, updateHash = true) {
  const target = document.querySelector(`[data-screen="${name}"]`) || document.querySelector('[data-screen="home"]');
  screens.forEach(screen => screen.classList.toggle('active', screen === target));
  navButtons.forEach(button => button.classList.toggle('active', button.dataset.route === name));
  document.body.classList.toggle('auth-mode', name === 'login');
  if (updateHash) history.replaceState(null, '', `#${name}`);
  document.getElementById('app').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

routeButtons.forEach(button => button.addEventListener('click', event => {
  event.preventDefault();
  route(button.dataset.route);
}));
document.querySelectorAll('[data-open-detail]').forEach(card => card.addEventListener('click', () => route('detail')));

document.querySelector('.upload-zone input').addEventListener('change', event => {
  if (!event.target.files.length) return;
  document.querySelector('.upload-zone').classList.add('hidden');
  document.getElementById('selectedMedia').classList.remove('hidden');
  showToast(`已选择 ${event.target.files.length} 个文件，可拖动调整顺序`);
});

document.querySelectorAll('.mood-picker button').forEach(button => button.addEventListener('click', event => {
  event.preventDefault();
  document.querySelectorAll('.mood-picker button').forEach(item => item.classList.remove('selected'));
  button.classList.add('selected');
}));

document.getElementById('saveMemory').addEventListener('click', () => {
  showToast('记忆已安全保存');
  window.setTimeout(() => route('home'), 650);
});

document.getElementById('recallButton').addEventListener('click', () => {
  route('detail');
  showToast('三年前的今天');
});

document.getElementById('searchInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') showToast(event.target.value ? `正在寻找“${event.target.value}”` : '请输入想找的记忆');
});

document.querySelector('.quiet-action').addEventListener('click', event => {
  event.currentTarget.textContent = '已从随机回忆中屏蔽';
  event.currentTarget.disabled = true;
  showToast('你仍然可以在记忆中找到它');
});

const consentInput = document.getElementById('privacyConsent');
document.querySelectorAll('[data-toggle-password]').forEach(button => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.togglePassword);
  input.type = input.type === 'password' ? 'text' : 'password';
  button.setAttribute('aria-label', input.type === 'password' ? '显示密码' : '隐藏密码');
}));

document.getElementById('passwordLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!consentInput.checked) return showToast('请先阅读并同意隐私政策');
  if (!supabaseClient || !authConfig.ownerEmail) return showToast('主人账户尚未配置，请检查 config.js');
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = '验证中…';
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email: authConfig.ownerEmail, password: document.getElementById('loginPassword').value });
  submitButton.disabled = false;
  submitButton.textContent = '安全登录';
  if (error || !data.session) return showToast(error?.status === 429 ? '尝试次数过多，请稍后重试' : '密码不正确');
  showToast('身份验证成功，正在进入私人空间');
  window.setTimeout(() => route('home'), 450);
});

document.getElementById('changePasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabaseClient || !authConfig.ownerEmail) return showToast('认证服务尚未配置');
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (newPassword.length < 10) return showToast('新密码至少需要 10 位');
  if (newPassword !== confirmPassword) return showToast('两次输入的新密码不一致');
  if (newPassword === currentPassword) return showToast('新密码不能与当前密码相同');
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = '正在验证…';
  const { error: verifyError } = await supabaseClient.auth.signInWithPassword({ email: authConfig.ownerEmail, password: currentPassword });
  if (verifyError) {
    submitButton.disabled = false;
    submitButton.textContent = '确认修改';
    return showToast('当前密码不正确');
  }
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
  submitButton.disabled = false;
  submitButton.textContent = '确认修改';
  if (error) return showToast('密码修改失败，请稍后重试');
  await supabaseClient.auth.signOut({ scope: 'others' });
  event.currentTarget.reset();
  showToast('密码已修改，请妥善保存');
  window.setTimeout(() => route('profile'), 500);
});

async function startApp() {
  if (supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    route(location.hash.slice(1) || (data.session ? 'home' : 'login'), false);
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!session && !document.querySelector('[data-screen="login"]').classList.contains('active')) route('login');
    });
  } else route(location.hash.slice(1) || 'login', false);
}

document.querySelector('[data-screen="profile"] [data-route="login"]').addEventListener('click', async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
});

startApp();
