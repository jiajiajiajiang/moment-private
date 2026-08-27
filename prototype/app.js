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
let activeMapEngine = null;
let amapReady = null;
let leafletReady = null;
let memoryCache = [];
let selectedMemoryId = null;
let collectionStatus = 'archived';
let editingMemoryId = null;
let customMoodValue = '';
let selectedDetailAssetIndex = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function detectMapEnvironment() {
  const offset = -new Date().getTimezoneOffset();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const isCN = offset === 480 && /Asia\/(Shanghai|Urumqi|Chongqing|Harbin)/.test(tz);
  const hasAmapKey = Boolean(authConfig.amapKey && !String(authConfig.amapKey).includes('YOUR_'));
  return { useAmap: isCN && hasAmapKey, useLeaflet: !(isCN && hasAmapKey) };
}

function loadAmapScript() {
  if (amapReady) return amapReady;
  amapReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('高德地图加载超时')), 5000);
    window.__amapReady = () => { clearTimeout(timeout); resolve(window.AMap); };
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(authConfig.amapKey)}&plugin=AMap.PlaceSearch,AMap.Geocoder&callback=__amapReady`;
    script.onerror = () => { clearTimeout(timeout); reject(new Error('高德脚本加载失败')); };
    document.head.appendChild(script);
  }).catch(error => { amapReady = null; throw error; });
  return amapReady;
}

function loadLeafletScript() {
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.L && window.L.map) return resolve(window.L);
      if (Date.now() - start > 5000) return reject(new Error('Leaflet 加载超时'));
      setTimeout(check, 50);
    };
    check();
  }).catch(error => { leafletReady = null; throw error; });
  return leafletReady;
}

function destroyMapEngine() {
  if (worldMap) {
    try {
      if (activeMapEngine === 'amap' && worldMap.destroy) worldMap.destroy();
      else if (activeMapEngine === 'leaflet' && worldMap.remove) worldMap.remove();
    } catch (e) { /* ignore */ }
  }
  worldMap = null;
  cityMarker = null;
  const container = document.getElementById('worldMap');
  if (container) container.innerHTML = '';
  const confirm = document.getElementById('confirmLocation');
  if (confirm) confirm.disabled = !selectedCity;
}

async function initLocationMap() {
  destroyMapEngine();
  const env = detectMapEnvironment();
  const container = document.getElementById('worldMap');
  try {
    if (env.useAmap) {
      await loadAmapScript();
      initAmapPicker(container);
      activeMapEngine = 'amap';
      refreshCityResultsPlaceholder('使用高德地图，搜索或点击选点');
      return;
    }
  } catch (error) {
    console.warn('高德地图加载失败，回退到 Leaflet:', error.message);
  }
  try {
    await loadLeafletScript();
    initLeafletPicker(container);
    activeMapEngine = 'leaflet';
    refreshCityResultsPlaceholder('使用 OpenStreetMap，搜索或点击选点');
    return;
  } catch (error) {
    console.warn('Leaflet 加载失败，回退到离线:', error.message);
  }
  initOfflinePicker();
  activeMapEngine = 'offline';
  refreshCityResultsPlaceholder('使用离线城市库，请输入城市名搜索');
}

function refreshCityResultsPlaceholder(message) {
  const results = document.getElementById('citySearchResults');
  if (results && !results.children.length) results.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function initAmapPicker(container) {
  worldMap = new AMap.Map(container, { zoom: 4, center: [104, 35] });
  worldMap.on('click', (event) => {
    const lnglat = event.lnglat;
    const geocoder = new AMap.Geocoder();
    geocoder.getAddress(lnglat, (status, result) => {
      if (status === 'complete' && result.info === 'OK') {
        const addr = result.regeocode.addressComponent;
        const name = [addr.city || addr.district || addr.province].filter(Boolean)[0] || result.regeocode.formattedAddress;
        setSelectedCity({ name, lat: lnglat.getLat(), lon: lnglat.getLng(), source: 'amap' });
      }
    });
  });
}

function initLeafletPicker(container) {
  worldMap = L.map(container, { zoomControl: true, attributionControl: true }).setView([30, 105], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 18
  }).addTo(worldMap);
  worldMap.on('click', (event) => reverseGeocodeOSM(event.latlng));
}

async function reverseGeocodeOSM(latlng) {
  const now = Date.now();
  if (now - lastGeoSearch < 1000) return;
  lastGeoSearch = now;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}&accept-language=zh-CN`);
    if (!res.ok) throw new Error('网络错误');
    const data = await res.json();
    const a = data.address || {};
    const name = a.city || a.town || a.village || a.county || a.state || (data.display_name || '').split(',')[0];
    setSelectedCity({ name, lat: latlng.lat, lon: latlng.lng, source: 'osm' });
  } catch (error) {
    showToast('逆地理失败，请手动搜索城市');
  }
}

function initOfflinePicker() {
  renderOfflineWorldMap(selectedCity);
}

function setSelectedCity({ name, lat, lon, source }) {
  selectedCity = { name, lat: Number(lat), lon: Number(lon), source };
  document.getElementById('confirmLocation').disabled = false;
  if (activeMapEngine === 'amap' && worldMap) {
    if (cityMarker) cityMarker.setPosition(new AMap.LngLat(selectedCity.lon, selectedCity.lat));
    else cityMarker = new AMap.Marker({ position: [selectedCity.lon, selectedCity.lat], map: worldMap });
  } else if (activeMapEngine === 'leaflet' && worldMap) {
    if (cityMarker) cityMarker.setLatLng([selectedCity.lat, selectedCity.lon]);
    else cityMarker = L.marker([selectedCity.lat, selectedCity.lon]).addTo(worldMap);
  } else if (activeMapEngine === 'offline') {
    renderOfflineWorldMap(selectedCity);
  }
}

async function searchCitiesOnline(query) {
  if (activeMapEngine === 'amap') {
    return new Promise((resolve, reject) => {
      const placeSearch = new AMap.PlaceSearch({ pageSize: 8, pageIndex: 1 });
      placeSearch.search(query, (status, result) => {
        if (status === 'complete' && result.info === 'OK' && result.poiList) {
          resolve(result.poiList.pois.map(poi => ({
            name: poi.name,
            lat: poi.location.lat,
            lon: poi.location.lng,
            source: 'amap',
            sub: [poi.address, poi.pname].filter(Boolean).join(' · ')
          })));
        } else {
          resolve([]);
        }
      });
    });
  }
  if (activeMapEngine === 'leaflet') {
    const now = Date.now();
    if (now - lastGeoSearch < 1000) return [];
    lastGeoSearch = now;
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=8&accept-language=zh-CN&q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(item => ({
      name: item.display_name.split(',')[0],
      lat: Number(item.lat),
      lon: Number(item.lon),
      source: 'osm',
      sub: item.display_name.split(',').slice(1, 3).join(',').trim()
    }));
  }
  // 离线兜底
  if (!localCities) await loadLocalCities();
  return searchLocalCities(query).map(city => ({
    name: cityLabel(city),
    lat: Number(city.lat),
    lon: Number(city.lon),
    source: 'offline',
    sub: `${city.ascii} · 人口约 ${Number(city.population || 0).toLocaleString('zh-CN')}`
  }));
}

function renderCityResults(items) {
  const results = document.getElementById('citySearchResults');
  results.innerHTML = '';
  if (!items.length) {
    results.innerHTML = '<p>没有找到，请尝试城市全名或英文名。</p>';
    return;
  }
  items.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sub || '')}</small>`;
    button.addEventListener('click', () => {
      document.querySelectorAll('#citySearchResults button').forEach(el => el.classList.remove('selected'));
      button.classList.add('selected');
      setSelectedCity(item);
    });
    results.appendChild(button);
  });
}

function route(name, updateHash = true) {
  const privateScreens = new Set(['home', 'create', 'timeline', 'memories', 'profile', 'detail', 'security', 'collection']);
  if (supabaseClient && privateScreens.has(name) && !hasSession) name = 'login';
  const target = document.querySelector(`[data-screen="${name}"]`) || document.querySelector('[data-screen="home"]');
  screens.forEach(screen => screen.classList.toggle('active', screen === target));
  navButtons.forEach(button => button.classList.toggle('active', button.dataset.route === name));
  document.body.classList.toggle('auth-mode', name === 'login');
  if (updateHash) history.replaceState(null, '', `#${name}`);
  document.getElementById('app').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (currentUser && ['home', 'timeline', 'memories', 'profile'].includes(name)) refreshAppData(name);
  if (name === 'detail' && selectedMemoryId) renderDetail();
  if (name === 'collection') loadCollection();
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
uploadInput.addEventListener('change', event => appendFiles(event.target.files));

function appendFiles(fileList) {
  const files = [...fileList].filter(file => file.type.startsWith('image/'));
  if (!files.length) return;
  selectedFiles.push(...files);
  uploadInput.value = '';
  renderMediaEditor();
  showToast(`共 ${selectedFiles.length} 张照片`);
}

function previewUrlFor(file) {
  if (!file.previewUrl) file.previewUrl = URL.createObjectURL(file);
  return file.previewUrl;
}

function moveMedia(from, to) {
  if (from === to || from < 0 || to < 0 || from >= selectedFiles.length || to >= selectedFiles.length) return;
  const [item] = selectedFiles.splice(from, 1);
  selectedFiles.splice(to, 0, item);
}

function removeMedia(index) {
  selectedFiles.splice(index, 1);
  renderMediaEditor();
}

function setCover(index) {
  moveMedia(index, 0);
  renderMediaEditor();
}

function renderMediaEditor() {
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
    thumb.className = index === 0 ? 'media-thumb is-cover' : 'media-thumb';
    thumb.draggable = true;
    thumb.style.backgroundImage = `url("${previewUrlFor(file)}")`;
    const coverButton = document.createElement('button');
    coverButton.type = 'button';
    coverButton.className = 'media-set-cover';
    coverButton.textContent = '设为封面';
    coverButton.disabled = index === 0;
    coverButton.addEventListener('click', () => setCover(index));
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'media-remove';
    removeButton.textContent = '×';
    removeButton.setAttribute('aria-label', '移除照片');
    removeButton.addEventListener('click', () => removeMedia(index));
    thumb.append(coverButton, removeButton);
    attachDragHandlers(thumb, index);
    container.appendChild(thumb);
  });
  const add = document.createElement('label');
  add.className = 'media-add';
  add.textContent = '＋';
  add.title = '继续添加照片';
  add.addEventListener('click', () => uploadInput.click());
  container.appendChild(add);
}

function attachDragHandlers(thumb, index) {
  thumb.addEventListener('dragstart', event => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    thumb.classList.add('dragging');
  });
  thumb.addEventListener('dragover', event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    thumb.classList.add('drag-over');
  });
  thumb.addEventListener('dragleave', () => thumb.classList.remove('drag-over'));
  thumb.addEventListener('drop', event => {
    event.preventDefault();
    thumb.classList.remove('drag-over');
    const from = Number(event.dataTransfer.getData('text/plain'));
    if (!Number.isNaN(from) && from !== index) {
      moveMedia(from, index);
      renderMediaEditor();
    }
  });
  thumb.addEventListener('dragend', () => thumb.classList.remove('dragging'));
}

document.querySelectorAll('.mood-picker button').forEach(button => button.addEventListener('click', event => {
  event.preventDefault();
  if (button.textContent.includes('自定义')) {
    const value = prompt('写下此刻的心情（最多 40 个字）', customMoodValue);
    if (value === null) return;
    customMoodValue = value.trim().slice(0, 40);
    button.textContent = customMoodValue ? `✦ ${customMoodValue}` : '＋ 自定义';
  } else customMoodValue = '';
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
    const values = {
      user_id: currentUser.id,
      content,
      event_at: new Date(eventAtValue).toISOString(),
      event_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      location_name: document.getElementById('locationName').value || null,
      location_latitude: document.getElementById('locationLatitude').value || null,
      location_longitude: document.getElementById('locationLongitude').value || null,
      fixed_mood: chosenMood(),
      custom_mood: customMoodValue || null,
      status: 'active'
    };
    const operation = editingMemoryId
      ? supabaseClient.from('memories').update(values).eq('id', editingMemoryId).select('id').single()
      : supabaseClient.from('memories').insert(values).select('id').single();
    const { data: memory, error } = await operation;
    if (error) throw error;
    await uploadMemoryFiles(memory.id);
    if (editingMemoryId) await supabaseClient.from('memory_tags').delete().eq('memory_id', memory.id);
    await saveTags(memory.id);
    const wasEditing = Boolean(editingMemoryId);
    resetComposer();
    showToast(wasEditing ? '修改已保存，旧版本已自动保留' : '记忆已加密保存到你的私人空间');
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
  editingMemoryId = null;
  customMoodValue = '';
  const customMoodButton = [...document.querySelectorAll('.mood-picker button')].find(button => button.textContent.includes('自定义') || button.textContent.startsWith('✦'));
  if (customMoodButton) customMoodButton.textContent = '＋ 自定义';
  document.querySelectorAll('.mood-picker button').forEach((button, index) => button.classList.toggle('selected', index === 0));
  document.querySelector('[data-screen="create"] h1').textContent = '记录此刻';
  uploadInput.value = '';
  renderMediaEditor();
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

function memoryTags(memory) {
  return (memory.memory_tags || []).map(link => link.tags?.name).filter(Boolean);
}

function moodLabel(memory) {
  return memory.custom_mood || ({ happy: '开心', calm: '平静', sad: '难过', healed: '治愈', excited: '兴奋', empty: '未设置' }[memory.fixed_mood] || '未设置');
}

async function refreshAppData(target = 'home') {
  const { data, error } = await supabaseClient.from('memories')
    .select('*,media_assets(*),memory_tags(tag_id,tags(id,name))')
    .order('event_at', { ascending: false });
  if (error) {
    console.error(error);
    showToast('读取记忆失败，请确认数据库结构和隐私策略');
    return;
  }
  memoryCache = data || [];
  if (target === 'home') await renderHome();
  if (target === 'timeline') renderTimeline();
  if (target === 'memories') await renderMemoryArchive();
  if (target === 'profile') await renderProfile();
}

async function memoryCard(memory, compact = false) {
  const date = new Date(memory.event_at);
  const assets = (memory.media_assets || []).sort((a, b) => a.sort_order - b.sort_order);
  const imageUrl = await signedImageUrl(assets[0]);
  const article = document.createElement('article');
  article.className = `memory-card stored-memory${compact ? ' compact-card' : ''}`;
  const raw = memory.content || '一段没有文字的记忆';
  const title = raw.length > 22 ? `${raw.slice(0, 22)}…` : raw;
  article.innerHTML = `${imageUrl ? `<div class="stored-photo"><img class="memory-original" src="${escapeHtml(imageUrl)}" alt="记忆照片" loading="lazy" decoding="async"><span class="photo-date">${String(date.getMonth() + 1).padStart(2, '0')} / ${String(date.getDate()).padStart(2, '0')}</span></div>` : ''}
    <div class="memory-copy"><div class="meta"><time>${date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}</time><span>${escapeHtml(memory.location_name || '未设置地点')}</span></div>
    <h3>${escapeHtml(title)}</h3><p>${escapeHtml(raw)}</p><div class="tags"><span>${escapeHtml(moodLabel(memory))}</span>${memoryTags(memory).map(tag => `<span>#${escapeHtml(tag)}</span>`).join('')}</div></div>`;
  article.addEventListener('click', () => openMemory(memory.id));
  return article;
}

async function renderHome(filter = 'all') {
  const feed = document.getElementById('memoryFeed');
  const empty = document.getElementById('memoryEmpty');
  let active = memoryCache.filter(memory => memory.status === 'active');
  if (filter === 'photo') active = active.filter(memory => memory.media_assets?.length);
  if (filter === 'location') active = active.filter(memory => memory.location_name);
  feed.innerHTML = '';
  empty.classList.toggle('hidden', active.length > 0);
  for (const memory of active) feed.appendChild(await memoryCard(memory));
  renderRecall(active);
}

function openMemory(id) {
  selectedMemoryId = id;
  route('detail');
}

async function renderRecall(active) {
  const button = document.getElementById('recallButton');
  const eligible = active.filter(memory => !memory.hidden_from_recall);
  if (!eligible.length) {
    button.disabled = true;
    button.querySelector('strong').textContent = '记录更多片刻后，这里会出现往日回忆。';
    return;
  }
  const today = new Date();
  const anniversaries = eligible.filter(memory => {
    const date = new Date(memory.event_at);
    return date.getMonth() === today.getMonth() && date.getDate() === today.getDate() && date.getFullYear() < today.getFullYear();
  });
  const chosen = anniversaries[0] || eligible[Math.floor(Math.random() * eligible.length)];
  button.disabled = false;
  button.dataset.memoryId = chosen.id;
  button.querySelector('strong').textContent = chosen.content?.slice(0, 34) || '一段过去的记忆';
}

function renderTimeline() {
  const active = memoryCache.filter(memory => memory.status === 'active');
  const years = [...new Set(active.map(memory => new Date(memory.event_at).getFullYear()))].sort((a, b) => b - a);
  const select = document.getElementById('timelineYear');
  const previous = Number(select.value);
  select.innerHTML = years.length ? years.map(year => `<option value="${year}">${year}</option>`).join('') : `<option>${new Date().getFullYear()}</option>`;
  if (years.includes(previous)) select.value = previous;
  renderTimelineYear(Number(select.value), document.querySelector('#timelineTabs .active')?.dataset.view || 'timeline');
}

function renderTimelineYear(year, view) {
  const memories = memoryCache.filter(memory => memory.status === 'active' && new Date(memory.event_at).getFullYear() === year);
  const content = document.getElementById('timelineContent');
  if (view === 'year') {
    const places = new Set(memories.map(memory => memory.location_name).filter(Boolean));
    const photos = memories.reduce((sum, memory) => sum + (memory.media_assets?.length || 0), 0);
    content.innerHTML = `<div class="annual-card"><p class="eyebrow">${year} IN MOMENTS</p><h2>${year}，你留下了 ${memories.length} 个片刻</h2><div class="memory-stats"><span><strong>${memories.length}</strong>条记忆</span><span><strong>${photos}</strong>张照片</span><span><strong>${places.size}</strong>个地点</span></div><p>${memories.length ? `这一年最常出现的心情是“${escapeHtml(topValue(memories.map(moodLabel)))}”。这些记录只属于你。` : '这一年还没有记录，从今天开始也不晚。'}</p></div>`;
    return;
  }
  const groups = new Map();
  memories.forEach(memory => {
    const month = new Date(memory.event_at).getMonth();
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(memory);
  });
  const names = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  content.innerHTML = `<div class="year-block"><div class="year-label"><strong>${year}</strong><span>${memories.length} 个瞬间</span></div><div class="months">${[...groups.entries()].sort((a,b)=>b[0]-a[0]).map(([month, items]) => `<button data-month="${month}"><span class="dot"></span><strong>${names[month]}</strong><small>${items.length} 条记忆</small></button>`).join('') || '<p class="muted">这一年还没有记忆。</p>'}</div></div>`;
  content.querySelectorAll('[data-month]').forEach(button => button.addEventListener('click', () => {
    const first = groups.get(Number(button.dataset.month))?.[0];
    if (first) openMemory(first.id);
  }));
}

function topValue(values) {
  const counts = values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '未设置';
}

async function renderMemoryArchive(query = '', filter = 'all') {
  let active = memoryCache.filter(memory => memory.status === 'active');
  const term = query.trim().toLowerCase();
  if (term) active = active.filter(memory => [memory.content, memory.location_name, moodLabel(memory), ...memoryTags(memory)].some(value => String(value || '').toLowerCase().includes(term)));
  if (filter === 'tag') active = active.filter(memory => memoryTags(memory).length);
  if (filter === 'location') active = active.filter(memory => memory.location_name);
  if (filter === 'mood') active = active.filter(memory => memory.fixed_mood || memory.custom_mood);
  const allActive = memoryCache.filter(memory => memory.status === 'active');
  const photoCount = allActive.reduce((sum, memory) => sum + (memory.media_assets?.length || 0), 0);
  const placeCount = new Set(allActive.map(memory => memory.location_name).filter(Boolean)).size;
  document.getElementById('memoryStats').innerHTML = `<span><strong>${allActive.length}</strong>个瞬间</span><span><strong>${photoCount}</strong>张照片</span><span><strong>${placeCount}</strong>个地点</span>`;
  const tagCounts = new Map();
  allActive.flatMap(memoryTags).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  const cloud = document.getElementById('tagCloud');
  cloud.innerHTML = [...tagCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([tag,count]) => `<button data-tag="${escapeHtml(tag)}"><strong>#${escapeHtml(tag)}</strong><small>${count} 条</small></button>`).join('') || '<p class="muted">还没有标签</p>';
  cloud.querySelectorAll('[data-tag]').forEach(button => button.addEventListener('click', () => {
    document.getElementById('searchInput').value = button.dataset.tag;
    renderMemoryArchive(button.dataset.tag, 'all');
  }));
  const gallery = document.getElementById('memoryGallery');
  gallery.innerHTML = '';
  for (const memory of active) {
    for (const asset of (memory.media_assets || []).sort((a,b)=>a.sort_order-b.sort_order)) {
      const url = await signedImageUrl(asset);
      if (!url) continue;
      const button = document.createElement('button');
      button.className = 'photo';
      button.style.backgroundImage = `url('${url}')`;
      button.ariaLabel = '打开记忆';
      button.addEventListener('click', () => openMemory(memory.id));
      gallery.appendChild(button);
    }
  }
  if (!gallery.children.length) gallery.innerHTML = '<div class="empty-inline">没有符合条件的照片</div>';
}

const locationDialog = document.getElementById('locationDialog');
let localCities = null;
document.getElementById('openLocationPicker').addEventListener('click', async () => {
  locationDialog.showModal();
  document.getElementById('citySearchResults').innerHTML = '';
  initLocationMap().catch(() => {
    activeMapEngine = 'offline';
    initOfflinePicker();
  });
  if (!localCities) loadLocalCities().catch(() => {});
});
document.getElementById('closeLocationPicker').addEventListener('click', () => locationDialog.close());

function cityLabel(result) {
  return [result.name, result.country].filter(Boolean).join(' · ');
}

async function loadLocalCities() {
  const response = await fetch('assets/cities15000.min.json', { cache: 'force-cache' });
  if (!response.ok) throw new Error('本地城市库加载失败');
  const rows = await response.json();
  localCities = rows.map(row => ({ name:row[0], ascii:row[1], country:row[2], lat:row[3], lon:row[4], population:row[5], aliases:row[6] }));
  return localCities;
}

function normalizeSearch(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function searchLocalCities(query) {
  const needle = normalizeSearch(query);
  return localCities.map(city => {
    const rawNames = [city.name, city.ascii, ...String(city.aliases || '').split('|')].filter(Boolean);
    const names = normalizeSearch(rawNames.join('|'));
    const exact = names.split('|').includes(needle);
    const prefix = names.split('|').some(name => name.startsWith(needle));
    const match = exact || prefix || names.includes(needle);
    const matchedName = rawNames.find(name => normalizeSearch(name) === needle) || rawNames.find(name => normalizeSearch(name).includes(needle));
    const displayCity = matchedName && /[^\u0000-\u00ff]/.test(matchedName) ? { ...city, name:matchedName } : city;
    return match ? { city:displayCity, score:(exact?3:prefix?2:1) * 1e12 + city.population } : null;
  }).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,8).map(item=>item.city);
}

function renderOfflineWorldMap(city = null) {
  const map = document.getElementById('worldMap');
  const marker = city ? `<div class="offline-city-marker" style="left:${((Number(city.lon)+180)/360)*100}%;top:${((90-Number(city.lat))/180)*100}%"><span></span><strong>${escapeHtml(city.name)}</strong></div>` : '';
  map.innerHTML = `<svg class="world-silhouette" viewBox="0 0 1000 500" role="img" aria-label="离线世界地图示意图"><rect width="1000" height="500" rx="18" fill="#dfe8e6"/><g fill="#aebeb5" stroke="#f5f3ef" stroke-width="3"><path d="M60 115L130 64l126 8 74 55-31 55-57 10-27 65-50 12-32-43-49-14-31-61z"/><path d="M260 274l63 25 35 75-20 93-42-12-22-91-38-43z"/><path d="M431 92l88-36 88 26 30 41 92 7 73 46-13 50-91 5-49-32-34 20-35-29-49-5-44-38-65 5-28-30z"/><path d="M509 220l80 5 51 56-14 112-48 65-53-30-19-94-45-49z"/><path d="M796 321l81-28 70 38-20 69-84 22-57-47z"/><path d="M918 158l32-19 30 16-15 34-39 3z"/></g><g stroke="rgba(255,255,255,.52)" stroke-width="1">${[100,200,300,400].map(y=>`<line x1="0" y1="${y}" x2="1000" y2="${y}"/>`).join('')}${[200,400,600,800].map(x=>`<line x1="${x}" y1="0" x2="${x}" y2="500"/>`).join('')}</g></svg>${marker}<div class="offline-map-label">内置离线世界城市图</div>`;
}

document.getElementById('citySearchForm').addEventListener('submit', async event => {
  event.preventDefault();
  const query = document.getElementById('citySearchInput').value.trim();
  if (!query) return showToast('请输入城市名称');
  const results = document.getElementById('citySearchResults');
  results.innerHTML = '<p>正在搜索…</p>';
  try {
    renderCityResults(await searchCitiesOnline(query));
  } catch (error) {
    results.innerHTML = `<p>${escapeHtml(error.message)}，请稍后重试。</p>`;
  }
});

function selectCity(city, button) {
  document.querySelectorAll('#citySearchResults button').forEach(item => item.classList.remove('selected'));
  if (button) button.classList.add('selected');
  setSelectedCity({ name: cityLabel(city), lat: Number(city.lat), lon: Number(city.lon), source: 'offline' });
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

document.getElementById('recallButton').addEventListener('click', event => {
  if (event.currentTarget.dataset.memoryId) openMemory(event.currentTarget.dataset.memoryId);
});

document.getElementById('homeFilterButton').addEventListener('click', event => {
  const filters = ['all', 'photo', 'location'];
  const labels = ['全部', '只看照片', '只看地点'];
  const next = (filters.indexOf(event.currentTarget.dataset.filter || 'all') + 1) % filters.length;
  event.currentTarget.dataset.filter = filters[next];
  event.currentTarget.textContent = labels[next];
  renderHome(filters[next]);
});

document.getElementById('searchInput').addEventListener('input', event => {
  const filter = document.querySelector('#memoryFilters .active')?.dataset.filter || 'all';
  renderMemoryArchive(event.target.value, filter);
});
document.querySelectorAll('#memoryFilters button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('#memoryFilters button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  renderMemoryArchive(document.getElementById('searchInput').value, button.dataset.filter);
}));
document.getElementById('timelineYear').addEventListener('change', event => renderTimelineYear(Number(event.target.value), document.querySelector('#timelineTabs .active').dataset.view));
document.querySelectorAll('#timelineTabs button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('#timelineTabs button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  renderTimelineYear(Number(document.getElementById('timelineYear').value), button.dataset.view);
}));

async function renderDetail() {
  const memory = memoryCache.find(item => item.id === selectedMemoryId);
  if (!memory) return;
  const assets = (memory.media_assets || []).sort((a,b)=>a.sort_order-b.sort_order);
  const urls = [];
  for (const asset of assets) urls.push(await signedImageUrl(asset));
  const photo = document.getElementById('detailPhoto');
  selectedDetailAssetIndex = 0;
  document.getElementById('downloadOriginal').disabled = !assets.length;
  photo.innerHTML = urls[0] ? `<img class="detail-original" src="${escapeHtml(urls[0])}" alt="记忆原图">` : '';
  photo.classList.toggle('no-photo', !urls[0]);
  const thumbs = document.getElementById('detailThumbs');
  thumbs.innerHTML = urls.map((url,index) => `<button class="photo${index===0?' active':''}" style="background-image:url('${escapeHtml(url)}')" data-index="${index}"></button>`).join('');
  thumbs.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    thumbs.querySelectorAll('button').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    selectedDetailAssetIndex = Number(button.dataset.index);
    photo.innerHTML = `<img class="detail-original" src="${escapeHtml(urls[selectedDetailAssetIndex])}" alt="记忆原图">`;
  }));
  const date = new Date(memory.event_at);
  document.getElementById('detailDate').textContent = date.toLocaleString('zh-CN', { dateStyle:'long', timeStyle:'short' });
  document.getElementById('detailTitle').textContent = (memory.content || '一段没有文字的记忆').split(/\n|。/)[0];
  document.getElementById('detailStory').textContent = memory.content || '这条记忆只有照片。';
  document.getElementById('detailLocation').textContent = memory.location_name || '未设置';
  document.getElementById('detailMood').textContent = moodLabel(memory);
  document.getElementById('detailTags').textContent = memoryTags(memory).map(tag=>`#${tag}`).join('　') || '未设置';
  document.getElementById('toggleRecall').textContent = memory.hidden_from_recall ? '重新加入“随机回忆”' : '不在“随机回忆”中出现';
}

document.getElementById('toggleRecall').addEventListener('click', async () => {
  const memory = memoryCache.find(item => item.id === selectedMemoryId);
  if (!memory) return;
  const value = !memory.hidden_from_recall;
  const { error } = await supabaseClient.from('memories').update({ hidden_from_recall: value }).eq('id', memory.id);
  if (error) return showToast('更新回忆设置失败');
  memory.hidden_from_recall = value;
  renderDetail();
  showToast(value ? '已从随机回忆中屏蔽' : '已重新加入随机回忆');
});

document.getElementById('editMemory').addEventListener('click', () => {
  const memory = memoryCache.find(item => item.id === selectedMemoryId);
  if (!memory) return;
  editingMemoryId = memory.id;
  document.getElementById('memoryContent').value = memory.content;
  document.getElementById('eventAt').value = toLocalDateTimeInput(new Date(memory.event_at));
  document.getElementById('locationName').value = memory.location_name || '';
  document.getElementById('locationLatitude').value = memory.location_latitude || '';
  document.getElementById('locationLongitude').value = memory.location_longitude || '';
  document.getElementById('locationLabel').textContent = memory.location_name || '搜索并选择城市';
  document.getElementById('memoryTags').value = memoryTags(memory).join('，');
  customMoodValue = memory.custom_mood || '';
  if (customMoodValue) {
    const custom = [...document.querySelectorAll('.mood-picker button')].find(button => button.textContent.includes('自定义') || button.textContent.startsWith('✦'));
    document.querySelectorAll('.mood-picker button').forEach(button => button.classList.remove('selected'));
    custom.textContent = `✦ ${customMoodValue}`;
    custom.classList.add('selected');
  } else {
    const moodTexts = { happy:'开心', calm:'平静', sad:'难过', healed:'治愈' };
    const target = [...document.querySelectorAll('.mood-picker button')].find(button => button.textContent.includes(moodTexts[memory.fixed_mood] || '开心'));
    document.querySelectorAll('.mood-picker button').forEach(button => button.classList.remove('selected'));
    target?.classList.add('selected');
  }
  document.querySelector('[data-screen="create"] h1').textContent = '编辑记忆';
  route('create');
});

document.getElementById('memoryMenu').addEventListener('click', () => document.getElementById('actionDialog').showModal());
document.getElementById('cancelMemoryAction').addEventListener('click', () => document.getElementById('actionDialog').close());
document.getElementById('archiveMemory').addEventListener('click', () => changeMemoryStatus('archived'));
document.getElementById('trashMemory').addEventListener('click', () => changeMemoryStatus('trashed'));
document.getElementById('memoryHistory').addEventListener('click', async () => {
  const { data, error } = await supabaseClient.from('memory_versions').select('version,snapshot,created_at').eq('memory_id', selectedMemoryId).order('version', {ascending:false});
  if (error) return showToast('读取修改历史失败');
  const list = document.getElementById('historyList');
  list.innerHTML = data.length ? data.map(item => `<article><strong>版本 ${item.version}</strong><small>${new Date(item.created_at).toLocaleString('zh-CN')}</small><p>${escapeHtml(item.snapshot?.content?.slice(0,120) || '无文字内容')}</p></article>`).join('') : '<p class="muted">这条记忆还没有修改历史。</p>';
  document.getElementById('actionDialog').close();
  document.getElementById('historyDialog').showModal();
});
document.getElementById('closeHistory').addEventListener('click', () => document.getElementById('historyDialog').close());

async function changeMemoryStatus(status) {
  const values = { status, archived_at: status === 'archived' ? new Date().toISOString() : null, trashed_at: status === 'trashed' ? new Date().toISOString() : null };
  const { error } = await supabaseClient.from('memories').update(values).eq('id', selectedMemoryId);
  if (error) return showToast('操作失败，请稍后重试');
  document.getElementById('actionDialog').close();
  showToast(status === 'archived' ? '已归档，可随时恢复' : '已移到回收站');
  await refreshAppData('home');
  route('home');
}

function currentShareText() {
  const memory = memoryCache.find(item => item.id === selectedMemoryId);
  if (!memory) return '';
  return `片刻 · ${new Date(memory.event_at).toLocaleDateString('zh-CN')}\n${memory.content || '一段照片记忆'}${memory.location_name ? `\n地点：${memory.location_name}` : ''}${memoryTags(memory).length ? `\n标签：${memoryTags(memory).map(tag => `#${tag}`).join(' ')}` : ''}`;
}

document.getElementById('shareMemory').addEventListener('click', () => {
  const text = currentShareText();
  if (!text) return;
  document.getElementById('shareSummary').value = text;
  document.getElementById('systemShareSummary').classList.toggle('hidden', !navigator.share);
  document.getElementById('shareDialog').showModal();
});

async function copyTextReliably(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

document.getElementById('copyShareSummary').addEventListener('click', async () => {
  const copied = await copyTextReliably(document.getElementById('shareSummary').value);
  if (!copied) return showToast('复制失败，请在文本框中手动选择复制');
  document.getElementById('shareDialog').close();
  showToast('摘要已复制，可直接粘贴到微信或其他应用');
});
document.getElementById('systemShareSummary').addEventListener('click', async () => {
  try {
    await navigator.share({ title:'我的片刻', text:document.getElementById('shareSummary').value });
    document.getElementById('shareDialog').close();
  } catch (error) { if (error.name !== 'AbortError') showToast('系统分享未完成，请使用“复制摘要”'); }
});
document.getElementById('downloadShareSummary').addEventListener('click', () => {
  const blob = new Blob([document.getElementById('shareSummary').value], {type:'text/plain;charset=utf-8'});
  downloadBlob(blob, `moment-${new Date().toISOString().slice(0,10)}.txt`);
  showToast('摘要文字已下载');
});
document.getElementById('closeShareDialog').addEventListener('click', () => document.getElementById('shareDialog').close());

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('downloadOriginal').addEventListener('click', async event => {
  const memory = memoryCache.find(item => item.id === selectedMemoryId);
  const assets = (memory?.media_assets || []).sort((a,b)=>a.sort_order-b.sort_order);
  const asset = assets[selectedDetailAssetIndex];
  if (!asset) return showToast('这条记忆没有可以下载的原图');
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = '下载中…';
  try {
    const { data, error } = await supabaseClient.storage.from('memory-media').download(asset.original_object_key);
    if (error) throw error;
    downloadBlob(data, asset.original_filename || `moment-original-${asset.id}`);
    showToast('原图已开始下载');
  } catch (error) {
    console.error(error);
    showToast('原图下载失败，请检查网络后重试');
  } finally {
    button.disabled = false;
    button.textContent = '下载原图';
  }
});

async function renderProfile() {
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  const active = memoryCache.filter(memory=>memory.status==='active');
  const name = profile?.display_name || '我的片刻';
  document.getElementById('profileName').textContent = name;
  document.getElementById('profileAvatar').textContent = name.slice(0,1);
  const earliest = [...active].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))[0];
  document.getElementById('profileSince').textContent = earliest ? `从 ${new Date(earliest.created_at).toLocaleDateString('zh-CN')} 开始记录 · ${active.length} 条记忆` : '还没有开始记录';
  document.getElementById('archiveCount').textContent = `${memoryCache.filter(m=>m.status==='archived').length} →`;
  document.getElementById('trashCount').textContent = `${memoryCache.filter(m=>m.status==='trashed').length} →`;
}

document.getElementById('editProfileButton').addEventListener('click', () => {
  document.getElementById('profileNameInput').value = document.getElementById('profileName').textContent;
  document.getElementById('profileDialog').showModal();
});
document.getElementById('profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  const display_name = document.getElementById('profileNameInput').value.trim();
  if (!display_name) return;
  const { error } = await supabaseClient.from('profiles').upsert({ id: currentUser.id, display_name });
  if (error) return showToast('资料保存失败');
  document.getElementById('profileDialog').close();
  renderProfile();
  showToast('个人资料已保存');
});

document.getElementById('openArchive').addEventListener('click', () => { collectionStatus='archived'; route('collection'); });
document.getElementById('openTrash').addEventListener('click', () => { collectionStatus='trashed'; route('collection'); });

async function loadCollection() {
  document.getElementById('collectionTitle').textContent = collectionStatus === 'archived' ? '归档' : '回收站';
  const list = document.getElementById('collectionList');
  const items = memoryCache.filter(memory => memory.status === collectionStatus);
  list.innerHTML = items.length ? '' : `<div class="empty-state"><span>◇</span><h3>这里是空的</h3><p>${collectionStatus === 'archived' ? '归档的记忆会安全地留在这里。' : '删除的记忆会在这里等待恢复。'}</p></div>`;
  for (const memory of items) {
    const row = document.createElement('div');
    row.className = 'collection-row';
    row.innerHTML = `<div><strong>${escapeHtml(memory.content?.slice(0,40) || '照片记忆')}</strong><small>${new Date(memory.event_at).toLocaleDateString('zh-CN')}</small></div><div><button data-restore>恢复</button>${collectionStatus==='trashed'?'<button class="danger" data-delete>永久删除</button>':''}</div>`;
    row.querySelector('[data-restore]').addEventListener('click', () => restoreMemory(memory.id));
    row.querySelector('[data-delete]')?.addEventListener('click', () => permanentlyDelete(memory));
    list.appendChild(row);
  }
}

async function restoreMemory(id) {
  const { error } = await supabaseClient.from('memories').update({ status:'active', archived_at:null, trashed_at:null }).eq('id',id);
  if (error) return showToast('恢复失败');
  await refreshAppData('profile');
  loadCollection();
  showToast('记忆已恢复');
}

async function permanentlyDelete(memory) {
  if (!confirm('永久删除后无法恢复，确定继续吗？')) return;
  const objectKeys = [...new Set((memory.media_assets || []).flatMap(asset => [asset.original_object_key, asset.display_object_key, asset.thumbnail_object_key]).filter(Boolean))];
  if (objectKeys.length) await supabaseClient.storage.from('memory-media').remove(objectKeys);
  const { error } = await supabaseClient.from('memories').delete().eq('id',memory.id).eq('status','trashed');
  if (error) return showToast('永久删除失败');
  await refreshAppData('profile');
  loadCollection();
  showToast('记忆已永久删除');
}

document.getElementById('exportMemories').addEventListener('click', () => {
  const exportData = memoryCache.map(({ media_assets, memory_tags, ...memory }) => ({ ...memory, tags: memoryTags({memory_tags}), media: (media_assets||[]).map(asset=>({ filename:asset.original_filename, type:asset.mime_type, bytes:asset.byte_size })) }));
  const blob = new Blob([JSON.stringify({ exported_at:new Date().toISOString(), memories:exportData }, null, 2)], {type:'application/json'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = `moment-backup-${new Date().toISOString().slice(0,10)}.json`; link.click(); URL.revokeObjectURL(link.href);
  showToast('文字、标签和媒体清单已导出；原图仍保留在私人存储中');
});
document.getElementById('privacySettings').addEventListener('click', () => showToast('隐私默认开启：不公开、不定位、图片使用短时访问链接'));
document.getElementById('futureMailbox').addEventListener('click', async () => {
  document.getElementById('futureUnlockAt').min = toLocalDateTimeInput(new Date(Date.now() + 60000));
  document.getElementById('futureUnlockAt').value = toLocalDateTimeInput(new Date(Date.now() + 86400000));
  await loadFutureLetters();
  document.getElementById('futureDialog').showModal();
});
document.getElementById('closeFuture').addEventListener('click', () => document.getElementById('futureDialog').close());

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
function base64ToBytes(value) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
async function deriveLetterKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:210000, hash:'SHA-256' }, material, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}
async function encryptLetter(content, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveLetterKey(passphrase, salt);
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, new TextEncoder().encode(content));
  return JSON.stringify({v:1,salt:bytesToBase64(salt),iv:bytesToBase64(iv),cipher:bytesToBase64(new Uint8Array(cipher))});
}
async function decryptLetter(payload, passphrase) {
  const data = JSON.parse(payload);
  const key = await deriveLetterKey(passphrase, base64ToBytes(data.salt));
  const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(data.iv)}, key, base64ToBytes(data.cipher));
  return new TextDecoder().decode(plain);
}
document.getElementById('futureLetterForm').addEventListener('submit', async event => {
  event.preventDefault();
  const content = document.getElementById('futureContent').value.trim();
  const passphrase = document.getElementById('futurePassphrase').value;
  const unlockAt = new Date(document.getElementById('futureUnlockAt').value);
  if (unlockAt <= new Date()) return showToast('解锁时间必须晚于现在');
  try {
    const ciphertext = await encryptLetter(content, passphrase);
    const { error } = await supabaseClient.from('future_letters').insert({user_id:currentUser.id,content_ciphertext:ciphertext,unlock_at:unlockAt.toISOString(),status:'sealed'});
    if (error) throw error;
    event.currentTarget.reset();
    await loadFutureLetters();
    showToast('未来信已在本机加密并封存');
  } catch (error) { console.error(error); showToast('未来信封存失败'); }
});
async function loadFutureLetters() {
  const { data, error } = await supabaseClient.from('future_letters').select('*').neq('status','deleted').order('unlock_at');
  const list = document.getElementById('futureLetterList');
  if (error) { list.innerHTML='<p class="muted">读取未来信失败。</p>'; return; }
  list.innerHTML = data.length ? data.map(letter => `<article><strong>${new Date(letter.unlock_at) <= new Date() ? '可以打开的信' : '尚未到达的信'}</strong><small>${new Date(letter.unlock_at).toLocaleString('zh-CN')}</small><button data-letter="${letter.id}" ${new Date(letter.unlock_at)>new Date()?'disabled':''}>${new Date(letter.unlock_at)<=new Date()?'输入密码打开':'等待解锁'}</button></article>`).join('') : '<p class="muted">还没有写给未来的信。</p>';
  list.querySelectorAll('[data-letter]:not(:disabled)').forEach(button => button.addEventListener('click', async () => {
    const letter = data.find(item=>item.id===button.dataset.letter);
    const passphrase = prompt('输入这封信的独立解锁密码');
    if (!passphrase) return;
    try { alert(await decryptLetter(letter.content_ciphertext, passphrase)); await supabaseClient.from('future_letters').update({status:'opened',opened_at:new Date().toISOString()}).eq('id',letter.id); }
    catch { showToast('密码错误或信件已损坏'); }
  }));
}

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
