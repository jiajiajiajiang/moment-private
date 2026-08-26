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

let hasSession = false;
let currentUser = null;
let selectedFiles = [];
let selectedCity = null;
let worldMap = null;
let cityMarker = null;
let lastGeoSearch = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function route(name, updateHash = true) {
  const privateScreens = new Set(['home', 'create', 'timeline', 'memories', 'profile', 'detail', 'security']);
  if (supabaseClient && privateScreens.has(name) && !hasSession) name = 'login';
  const target = document.querySelector(`[data-screen="${name}"]`) || document.querySelector('[data-screen="home"]');
  screens.forEach(screen => screen.classList.toggle('active', screen === target));
  navButtons.forEach(button => button.classList.toggle('active', button.dataset.route === name));
  document.body.classList.toggle('auth-mode', name === 'login');
  if (updateHash) history.replaceState(null, '', `#${name}`);
  document.getElementById('app').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'home' && currentUser) loadMemories();
}

routeButtons.forEach(button => button.addEventListener('click', event => {
  event.preventDefault();
  route(button.dataset.route);
}));
document.querySelectorAll('[data-open-detail]').forEach(card => card.addEventListener('click', () => route('detail')));

function toLocalDateTimeInput(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}
document.getElementById('eventAt').value = toLocalDateTimeInput();

const uploadInput = document.querySelector('.upload-zone input');
uploadInput.addEventListener('change', event => {
  selectedFiles = [...event.target.files];
  renderSelectedMedia();
});

function renderSelectedMedia() {
  const container = document.getElementById('selectedMedia');
  container.innerHTML = '';
  if (!selectedFiles.length) {
    document.querySelector('.upload-zone').classList.remove('hidden');
    container.classList.add('hidden');
    return;
  }
  document.querySelector('.upload-zone').classList.add('hidden');
  container.classList.remove('hidden');
  selectedFiles.forEach((file, index) => {
    const thumb = document.createElement('div');
    thumb.className = 'media-thumb';
    thumb.style.backgroundImage = `url("${URL.createObjectURL(file)}")`;
    thumb.innerHTML = `${index === 0 ? '<span>封面</span>' : ''}<button type="button" aria-label="移除照片">×</button>`;
    thumb.querySelector('button').addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderSelectedMedia();
    });
    container.appendChild(thumb);
  });
  const add = document.createElement('label');
  add.className = 'media-add';
  add.textContent = '＋';
  add.title = '重新选择照片';
  add.addEventListener('click', () => uploadInput.click());
  container.appendChild(add);
  showToast(`已选择 ${selectedFiles.length} 张照片`);
}

document.querySelectorAll('.mood-picker button').forEach(button => button.addEventListener('click', event => {
  event.preventDefault();
  document.querySelectorAll('.mood-picker button').forEach(item => item.classList.remove('selected'));
  button.classList.add('selected');
}));

function chosenMood() {
  const text = document.querySelector('.mood-picker .selected')?.textContent.trim() || '';
  const moods = { '☀ 开心': 'happy', '◐ 平静': 'calm', '☂ 难过': 'sad', '♧ 治愈': 'healed' };
  return moods[text] || 'empty';
}

async function uploadMemoryFiles(memoryId) {
  for (let index = 0; index < selectedFiles.length; index += 1) {
    const file = selectedFiles[index];
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `${currentUser.id}/${memoryId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabaseClient.storage.from('memory-media').upload(key, file, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false
    });
    if (uploadError) throw uploadError;
    const { error: mediaError } = await supabaseClient.from('media_assets').insert({
      memory_id: memoryId,
      user_id: currentUser.id,
      kind: 'image',
      original_object_key: key,
      display_object_key: key,
      thumbnail_object_key: key,
      original_filename: file.name,
      mime_type: file.type,
      byte_size: file.size,
      sort_order: index,
      processing_status: 'ready'
    });
    if (mediaError) throw mediaError;
  }
}

async function saveTags(memoryId) {
  const names = document.getElementById('memoryTags').value.split(/[,，]/).map(tag => tag.trim().replace(/^#/, '')).filter(Boolean);
  for (const name of [...new Set(names)]) {
    let { data: tag, error } = await supabaseClient.from('tags').select('id').eq('user_id', currentUser.id).eq('normalized_name', name.toLowerCase()).maybeSingle();
    if (error) throw error;
    if (!tag) {
      const created = await supabaseClient.from('tags').insert({ user_id: currentUser.id, name }).select('id').single();
      if (created.error) throw created.error;
      tag = created.data;
    }
    const { error: linkError } = await supabaseClient.from('memory_tags').insert({ memory_id: memoryId, tag_id: tag.id, user_id: currentUser.id });
    if (linkError) throw linkError;
  }
}

document.getElementById('saveMemory').addEventListener('click', async event => {
  const content = document.getElementById('memoryContent').value.trim();
  if (!content && !selectedFiles.length) return showToast('请先写下一句话或添加照片');
  if (!supabaseClient || !currentUser) return showToast('请先登录主人账户');
  const eventAtValue = document.getElementById('eventAt').value;
  if (!eventAtValue) return showToast('请选择事件时间');
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    const { data: memory, error } = await supabaseClient.from('memories').insert({
      user_id: currentUser.id,
      content,
      event_at: new Date(eventAtValue).toISOString(),
      event_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      location_name: document.getElementById('locationName').value || null,
      location_latitude: document.getElementById('locationLatitude').value || null,
      location_longitude: document.getElementById('locationLongitude').value || null,
      fixed_mood: chosenMood(),
      status: 'active'
    }).select('id').single();
    if (error) throw error;
    await uploadMemoryFiles(memory.id);
    await saveTags(memory.id);
    resetComposer();
    showToast('记忆已加密保存到你的私人空间');
    route('home');
  } catch (error) {
    console.error(error);
    showToast(error.message?.includes('row-level security') ? '保存被隐私策略阻止，请确认数据库脚本已完整执行' : `保存失败：${error.message || '请稍后重试'}`);
  } finally {
    button.disabled = false;
    button.textContent = '保存';
  }
});

function resetComposer() {
  document.getElementById('memoryContent').value = '';
  document.getElementById('memoryTags').value = '';
  document.getElementById('eventAt').value = toLocalDateTimeInput();
  document.getElementById('locationName').value = '';
  document.getElementById('locationLatitude').value = '';
  document.getElementById('locationLongitude').value = '';
  document.getElementById('locationLabel').textContent = '搜索并选择城市';
  selectedFiles = [];
  uploadInput.value = '';
  renderSelectedMedia();
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function signedImageUrl(asset) {
  const key = asset?.thumbnail_object_key || asset?.display_object_key || asset?.original_object_key;
  if (!key) return '';
  const { data } = await supabaseClient.storage.from('memory-media').createSignedUrl(key, 3600);
  return data?.signedUrl || '';
}

async function loadMemories() {
  const feed = document.getElementById('memoryFeed');
  const empty = document.getElementById('memoryEmpty');
  const { data, error } = await supabaseClient.from('memories')
    .select('id,content,event_at,location_name,fixed_mood,custom_mood,media_assets(*)')
    .eq('status', 'active')
    .order('event_at', { ascending: false });
  if (error) {
    console.error(error);
    showToast('读取记忆失败，请确认数据库结构和隐私策略');
    return;
  }
  feed.querySelectorAll('.demo-memory,.stored-memory').forEach(card => card.remove());
  empty.classList.toggle('hidden', data.length > 0);
  for (const memory of data) {
    const date = new Date(memory.event_at);
    const imageUrl = await signedImageUrl((memory.media_assets || []).sort((a, b) => a.sort_order - b.sort_order)[0]);
    const article = document.createElement('article');
    article.className = 'memory-card stored-memory';
    const preview = escapeHtml(memory.content || '一段没有文字的记忆');
    const title = preview.length > 22 ? `${preview.slice(0, 22)}…` : preview;
    article.innerHTML = `${imageUrl ? `<div class="photo stored-photo" style="background-image:url('${escapeHtml(imageUrl)}')"><span class="photo-date">${String(date.getMonth() + 1).padStart(2, '0')} / ${String(date.getDate()).padStart(2, '0')}</span></div>` : ''}
      <div class="memory-copy"><div class="meta"><time>${date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}</time><span>${escapeHtml(memory.location_name || '未设置地点')}</span></div>
      <h3>${title}</h3><p>${preview}</p><div class="tags"><span>${escapeHtml(memory.custom_mood || memory.fixed_mood || '此刻')}</span></div></div>`;
    feed.appendChild(article);
  }
}

const locationDialog = document.getElementById('locationDialog');
document.getElementById('openLocationPicker').addEventListener('click', () => {
  locationDialog.showModal();
  if (!worldMap) {
    if (!window.L) {
      document.getElementById('citySearchResults').innerHTML = '<p>地图组件加载失败，请检查网络后刷新页面。</p>';
      showToast('地图组件没有加载，请检查网络连接');
      return;
    }
    worldMap = L.map('worldMap', { worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(worldMap);
  }
  window.setTimeout(() => worldMap?.invalidateSize(), 120);
});
document.getElementById('closeLocationPicker').addEventListener('click', () => locationDialog.close());

function cityLabel(result) {
  const address = result.address || {};
  const city = address.city || address.town || address.village || address.municipality || result.name;
  return [city, address.state, address.country].filter(Boolean).filter((item, index, list) => list.indexOf(item) === index).join(' · ');
}

document.getElementById('citySearchForm').addEventListener('submit', async event => {
  event.preventDefault();
  const query = document.getElementById('citySearchInput').value.trim();
  if (!query) return showToast('请输入城市名称');
  const wait = 1000 - (Date.now() - lastGeoSearch);
  if (wait > 0) await new Promise(resolve => window.setTimeout(resolve, wait));
  lastGeoSearch = Date.now();
  const results = document.getElementById('citySearchResults');
  results.innerHTML = '<p>正在世界地图中寻找…</p>';
  try {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: '6', featuretype: 'city' });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!response.ok) throw new Error('地图服务暂时不可用');
    const cities = await response.json();
    results.innerHTML = '';
    if (!cities.length) results.innerHTML = '<p>没有找到，请尝试城市全名或英文名。</p>';
    cities.forEach(city => {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<strong>${escapeHtml(cityLabel(city))}</strong><small>${escapeHtml(city.display_name)}</small>`;
      button.addEventListener('click', () => selectCity(city, button));
      results.appendChild(button);
    });
  } catch (error) {
    results.innerHTML = `<p>${escapeHtml(error.message)}，请稍后重试。</p>`;
  }
});

function selectCity(city, button) {
  if (!worldMap || !window.L) return;
  document.querySelectorAll('#citySearchResults button').forEach(item => item.classList.remove('selected'));
  button.classList.add('selected');
  selectedCity = { name: cityLabel(city), lat: Number(city.lat), lon: Number(city.lon) };
  if (cityMarker) cityMarker.remove();
  cityMarker = L.marker([selectedCity.lat, selectedCity.lon]).addTo(worldMap).bindPopup(escapeHtml(selectedCity.name)).openPopup();
  worldMap.setView([selectedCity.lat, selectedCity.lon], 8);
  document.getElementById('confirmLocation').disabled = false;
}

document.getElementById('confirmLocation').addEventListener('click', () => {
  if (!selectedCity) return;
  document.getElementById('locationName').value = selectedCity.name;
  document.getElementById('locationLatitude').value = selectedCity.lat;
  document.getElementById('locationLongitude').value = selectedCity.lon;
  document.getElementById('locationLabel').textContent = selectedCity.name;
  locationDialog.close();
  showToast(`已选择 ${selectedCity.name}`);
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
  hasSession = true;
  currentUser = data.session.user;
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
    hasSession = Boolean(data.session);
    currentUser = data.session?.user || null;
    route(location.hash.slice(1) || (data.session ? 'home' : 'login'), false);
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      hasSession = Boolean(session);
      currentUser = session?.user || null;
      if (!session && !document.querySelector('[data-screen="login"]').classList.contains('active')) route('login');
    });
  } else route(location.hash.slice(1) || 'login', false);
}

document.querySelector('[data-screen="profile"] [data-route="login"]').addEventListener('click', async () => {
  if (supabaseClient) await supabaseClient.auth.signOut();
});

startApp();
