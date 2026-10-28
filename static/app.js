'use strict';
const {esc, notify, openDialog, closeDialog, field, fieldError, clearErrors, validateForm, submitForm, emailRule, required, date} = UI;
const state = {stage:'basic', user:null, csrf:'', events:[], receipt:null, pendingEvent:null, adminTab:'events', adminPage:1, myPage:1, routeEpoch:0};
const main = document.getElementById('main-content');
const byId = id => state.events.find(event => event.id === id);
async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, {
      method:options.method || 'GET', credentials:'same-origin', signal:controller.signal,
      headers:options.body ? {'Content-Type':'application/json','X-CSRF-Token':state.csrf} : {},
      body:options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || '暂时无法完成，请重试。'); error.field = data.field; error.status = response.status; throw error; }
    return data;
  } catch(error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('连接暂时中断。请确认本地服务仍在运行，再重试。');
    throw error;
  } finally { clearTimeout(timeout); }
}
async function refreshEvents() { state.events = (await api('/api/events')).events; }
function updateNavigation() {
  document.getElementById('stage-label').textContent = state.stage === 'members' ? '会员版 · 本地演示' : '基础版 · 本地演示';
  document.getElementById('member-links').innerHTML = state.stage === 'members' ? `<a id="my-link" href="#my">我的报名</a>${state.user?.role === 'admin' ? '<a id="admin-link" href="#admin">管理后台</a>' : ''}` : '';
  document.getElementById('account-actions').innerHTML = state.stage !== 'members' ? '' : state.user ? `<span>${esc(state.user.display_name)}</span><button class="text-button" data-action="logout">退出</button>` : '<button class="button small" data-action="login">登录 / 注册 <span aria-hidden="true">↗</span></button>';
  const active = (location.hash || '#home').split('/')[0];
  document.querySelectorAll('#main-nav a').forEach(link => { if (link.getAttribute('href') === active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current'); });
}
function errorView(message) {
  main.innerHTML = `<div class="page empty-view"><span class="eyebrow">暂时没有连接成功</span><h2>再试一次，我们继续。</h2><p role="alert">${esc(message)}</p><button class="button" data-action="retry">重新加载</button></div>`;
}
function eventMeta(event) {
  return `<div class="event-meta"><span><b class="meta-icon" aria-hidden="true">◷</b>${esc(date(event.starts_at))} · 北京时间</span><span><b class="meta-icon" aria-hidden="true">⌁</b>${esc(event.location)}</span></div>`;
}
function eventCard(event, index) {
  return `<article class="card event-card"><div class="card-top"><span class="badge">${esc(event.category)}</span><span class="event-number">${String(index+1).padStart(2,'0')} / NOV</span></div><h3><a href="#event/${encodeURIComponent(event.id)}">${esc(event.title)}</a></h3><p class="subtitle">${esc(event.subtitle)}</p>${eventMeta(event)}<div class="card-bottom"><span class="capacity"><strong>${esc(event.registered)}</strong> / ${esc(event.capacity)} 人已报名</span><a class="button secondary small" href="#event/${encodeURIComponent(event.id)}">查看活动 <span aria-hidden="true">↗</span></a></div></article>`;
}
function homeView() {
  const first = state.events[0];
  main.innerHTML = `<div class="page"><section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><div class="eyebrow">A PLACE FOR PEOPLE WHO MAKE</div><h1 id="hero-title">让想法，<br>在这里<span>发生。</span></h1><p>遇见同样热爱创造的人。<br>从一次动手、一次交流，开始你的下一个作品。</p><div class="hero-actions"><a class="button" href="${first ? '#event/'+encodeURIComponent(first.id) : '#home'}">${first ? '报名创造者之夜' : '探索近期活动'} <span aria-hidden="true">↗</span></a><button class="button secondary" data-action="scroll-events">看看近期活动 <span aria-hidden="true">↓</span></button></div><div class="hero-note"><span class="dot" aria-hidden="true"></span><span>开放交流 · 小班共创 · 带上好奇心就好</span></div></div><div class="hero-poster"><img src="/poster.svg" alt="创造者活动海报：MAKE IT REAL，把想法变成作品"><div class="poster-caption"><span>${first ? esc(date(first.starts_at)) : 'MAKERS CLUB'}</span><span>${first ? esc(first.category) : '一起造物'} <span aria-hidden="true">↗</span></span></div></div></section><section id="events-section" aria-labelledby="events-title"><div class="section-heading"><div><span class="eyebrow">UPCOMING GATHERINGS</span><h2 id="events-title">近期，一起做点什么。</h2></div><p>找到你的下一次灵感碰面。</p></div><div class="event-grid">${state.events.map(eventCard).join('')}</div>${!state.events.length ? '<div class="notice">暂时没有活动，请稍后再来。</div>' : ''}</section></div>`;
}
function detailView(event) {
  if (!event) { main.innerHTML = '<div class="page empty-view"><h2>这场活动暂时找不到了。</h2><a class="button" href="#home">返回活动首页</a></div>'; return; }
  main.innerHTML = `<div class="page"><a class="back-link" href="#home">← 返回活动列表</a><div class="detail-grid"><div class="detail-poster"><img src="/poster.svg" alt="一起造物活动海报"></div><section class="detail-copy"><span class="badge">${esc(event.category)}</span><h1>${esc(event.title)}</h1><p class="lead">${esc(event.subtitle)}</p><dl class="detail-facts"><div><dt>活动时间 · 北京时间</dt><dd>${esc(date(event.starts_at))}</dd></div><div><dt>活动地点</dt><dd>${esc(event.location)}</dd></div><div><dt>小班名额</dt><dd>${esc(event.capacity)} 人</dd></div><div><dt>当前报名</dt><dd>${esc(event.registered)} 人已加入</dd></div></dl><h3>关于这次相聚</h3><p class="description">${esc(event.description)}</p><div class="detail-aside"><button class="button" data-action="signup" data-id="${esc(event.id)}" ${event.registered >= event.capacity ? 'disabled' : ''}>${event.registered >= event.capacity ? '本场名额已满' : '立即报名'} <span aria-hidden="true">↗</span></button><span class="muted capacity">${state.stage === 'members' ? '登录后报名 · 在个人中心查看记录' : '填写姓名与邮箱，即可报名'}</span></div><div class="info-strip"><span><strong>01</strong> 选择活动</span><span>→</span><span><strong>02</strong> 完成报名</span><span>→</span><span><strong>03</strong> 一起创造</span></div></section></div></div>`;
}
function openSignup(eventId) {
  const event = byId(eventId);
  if (!event) { notify('活动信息已更新，请刷新后重试。','error'); return; }
  if (state.stage === 'members' && !state.user) { state.pendingEvent = eventId; openAuth('login'); return; }
  const fields = state.stage === 'basic' ? field('display_name','怎么称呼你？','','text','autocomplete="name" maxlength="40" autofocus') + field('email','联系邮箱','','email','autocomplete="email" maxlength="254" placeholder="例如 guest@example.test"') : `<div class="identity"><span class="avatar" aria-hidden="true">${esc(state.user.display_name.slice(0,1))}</span><div><strong>${esc(state.user.display_name)}</strong><small>${esc(state.user.email)}</small></div></div>`;
  openDialog(`<div class="dialog-kicker">JOIN THE GATHERING</div><h2 class="dialog-title" id="dialog-title">报名 · ${esc(event.title)}</h2><p class="dialog-intro">${esc(date(event.starts_at))} · ${esc(event.location)}</p><form id="signup-form" data-event="${esc(event.id)}" novalidate>${fields}<div class="form-error" role="alert" tabindex="-1" hidden></div><div class="notice">报名成功后，信息会保存在本机的演示数据库中。请使用模拟资料参与测试。</div><button class="button full" type="submit">确认报名 <span aria-hidden="true">↗</span></button></form>`);
}
async function submitSignup(form) {
  const rules = state.stage === 'basic' ? {display_name:required('称呼',40),email:emailRule} : {};
  if (!validateForm(form,rules)) return;
  await submitForm(form, async () => {
    const body = {event_id:form.dataset.event};
    if (state.stage === 'basic') { body.display_name = form.elements.display_name.value.trim(); body.email = form.elements.email.value.trim(); }
    const result = await api('/api/registrations', {method:'POST',body});
    state.receipt = {...result.registration, ...{title:byId(form.dataset.event).title, starts_at:byId(form.dataset.event).starts_at, location:byId(form.dataset.event).location}};
    closeDialog(true);
    await refreshEvents();
    location.hash = 'success/' + encodeURIComponent(result.registration.id);
    notify('报名成功，信息已保存。','success');
  });
}
function receiptLines(record) {
  return `<div class="receipt-lines"><div class="receipt-line"><span>活动</span><strong>${esc(record.title)}</strong></div><div class="receipt-line"><span>活动时间</span><strong>${esc(date(record.starts_at))} · 北京时间</strong></div><div class="receipt-line"><span>报名人</span><strong>${esc(record.display_name)}</strong></div><div class="receipt-line"><span>联系邮箱</span><strong>${esc(record.email)}</strong></div><div class="receipt-line"><span>报名编号</span><strong class="mono">${esc(record.id)}</strong></div></div>`;
}
async function successView(id, epoch) {
  let record = state.receipt?.id === id ? state.receipt : null;
  if (!record && state.stage === 'members' && state.user) {
    try { record = (await api('/api/registrations/'+encodeURIComponent(id))).registration; }
    catch(error) { if(epoch === state.routeEpoch) errorView(error.message); return; }
  }
  if (epoch !== state.routeEpoch) return;
  if (!record) { main.innerHTML = '<div class="page empty-view"><h2>继续发现有意思的活动。</h2><p>基础版的报名回执在提交后展示；刷新后可回到活动首页继续浏览。</p><a class="button" href="#home">返回活动首页</a></div>'; return; }
  main.innerHTML = `<div class="page"><section class="card receipt"><div class="receipt-icon" aria-hidden="true">✓</div><span class="eyebrow">YOU'RE ON THE LIST</span><h1>报名成功，期待见面。</h1><p>你的报名信息已保存，这次相聚有你一席。</p>${receiptLines(record)}<div class="hero-actions">${state.stage === 'members' ? '<a class="button" href="#my">查看我的报名</a>' : ''}<a class="button secondary" href="#home">继续发现活动 ↗</a></div></section></div>`;
}
async function renderRoute() {
  const epoch = ++state.routeEpoch;
  const [route,id] = (location.hash.slice(1) || 'home').split('/');
  const title = route === 'event' ? (byId(decodeURIComponent(id || ''))?.title || '活动详情') : route === 'my' ? '我的报名' : route === 'admin' ? (state.user?.role === 'admin' ? '活动管理' : '访问受限') : route === 'success' ? '报名结果' : '发现活动';
  document.title = title + ' · 一起造物';
  updateNavigation();
  if (route === 'event') detailView(byId(decodeURIComponent(id || '')));
  else if (route === 'success') await successView(decodeURIComponent(id || ''),epoch);
  else if (route === 'my' && state.stage === 'members') await myView(epoch);
  else if (route === 'admin' && state.stage === 'members') await adminView(epoch);
  else homeView();
}
async function boot() {
  try {
    const session = await api('/api/session');
    Object.assign(state,{stage:session.stage,csrf:session.csrf,user:session.user});
    await refreshEvents();
    await renderRoute();
  } catch(error) { errorView(error.message); }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'signup') openSignup(button.dataset.id);
  else if (action === 'close-dialog') closeDialog();
  else if (action === 'discard-close') closeDialog(true);
  else if (action === 'continue-edit') { document.getElementById('discard-prompt').hidden = true; document.getElementById('main-dialog').querySelector('input,textarea,button').focus(); }
  else if (action === 'scroll-events') document.getElementById('events-section')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',block:'start'});
  else if (action === 'retry') await boot();
  else if (typeof memberAction === 'function') { try { await memberAction(action,button); } catch(error) { notify(error.message,'error'); } }
});
document.addEventListener('submit', async event => {
  if (event.target.id === 'signup-form') { event.preventDefault(); await submitSignup(event.target); }
  else if (typeof memberSubmit === 'function') await memberSubmit(event);
});
window.addEventListener('hashchange', () => { renderRoute().catch(error => errorView(error.message)); window.scrollTo({top:0,behavior:'instant'}); });

/* Additional workflows present only in the membership snapshot. */
function openAuth(mode = 'login') {
  const register = mode === 'register';
  const intro = register ? '创建一个账号，加入你的第一场活动。' : '登录后，可以报名活动并查看自己的记录。';
  openDialog(`<div class="dialog-kicker">YOUR NEXT IDEA STARTS HERE</div><h2 class="dialog-title" id="dialog-title">${register ? '很高兴，在这里遇见你。' : '欢迎回到一起造物。'}</h2><p class="dialog-intro">${intro}</p><form id="auth-form" data-mode="${mode}" novalidate>${register ? field('display_name','怎么称呼你？','','text','autocomplete="name" maxlength="40"') : ''}${field('email','邮箱','','email','autocomplete="username" maxlength="254" autofocus')}<div class="password-box">${field('password','密码','','password',`autocomplete="${register ? 'new-password' : 'current-password'}" minlength="10" maxlength="128"`)}<button class="password-toggle" type="button" data-action="toggle-password" aria-label="显示密码" aria-pressed="false">显示</button></div>${register ? '<p class="muted record-id">密码至少10个字符。新注册账号默认为普通用户。</p>' : ''}<div class="form-error" role="alert" tabindex="-1" hidden></div><button class="button full" type="submit">${register ? '注册并加入' : '登录账号'} <span aria-hidden="true">↗</span></button><p class="form-switch">${register ? '已经有账号？' : '第一次来到这里？'} <button class="text-button" type="button" data-action="${register ? 'login' : 'register'}">${register ? '直接登录' : '注册账号'}</button></p></form>`);
}
function loginNeeded(label) {
  main.innerHTML = `<div class="page empty-view"><span class="eyebrow">YOUR OWN SPACE</span><h2>先登录，再${esc(label)}。</h2><p>用自己的账号继续，报名记录会保存在你的个人空间里。</p><button class="button" data-action="login">登录账号 ↗</button><a class="text-button" href="#home">先看看活动</a></div>`;
}
async function myView(epoch) {
  if (!state.user) { loginNeeded('查看报名'); return; }
  main.innerHTML = '<div class="page loading-view" role="status">正在读取你的报名记录…</div>';
  const result = await api('/api/registrations?page='+state.myPage);
  if (epoch !== state.routeEpoch) return;
  main.innerHTML = `<div class="page"><div class="page-heading"><div><span class="eyebrow">YOUR NEXT GATHERING</span><h1>每一次相聚，都有记录。</h1><p>这里是 ${esc(state.user.display_name)} 的 ${esc(result.total)} 条报名记录。</p></div><div class="identity"><span class="avatar" aria-hidden="true">${esc(state.user.display_name.slice(0,1))}</span><div><strong>${esc(state.user.display_name)}</strong><small>${esc(state.user.email)} · ${state.user.role === 'admin' ? '管理员' : '普通用户'}</small></div></div></div>${result.registrations.length ? `<div class="record-grid">${result.registrations.map(record => `<article class="card record-card"><div class="card-top"><span class="badge green">已报名</span><span class="record-id mono">${esc(record.id)}</span></div><h3>${esc(record.title)}</h3><p class="muted record-id">${esc(record.display_name)} · ${esc(record.email)}</p>${eventMeta(record)}<div class="card-bottom"><span class="record-id">报名时间 ${esc(date(record.created_at))}</span><button class="button secondary small" data-action="record-detail" data-id="${esc(record.id)}">查看详情 ↗</button></div></article>`).join('')}</div>${pagination(result,'my')}` : '<div class="card empty-view"><h2>你的第一场活动，正在等你。</h2><p>还没有报名记录，去发现一场感兴趣的活动吧。</p><a class="button" href="#home">发现活动 ↗</a></div>'}</div>`;
}
function pagination(result,scope) {
  if (result.total <= result.page_size) return '';
  return `<div class="pagination"><span>共 ${esc(result.total)} 条 · 第 ${esc(result.page)} 页</span><button class="button secondary small" data-action="page" data-scope="${scope}" data-page="${result.page-1}" ${result.page <= 1 ? 'disabled' : ''}>上一页</button><button class="button secondary small" data-action="page" data-scope="${scope}" data-page="${result.page+1}" ${result.page * result.page_size >= result.total ? 'disabled' : ''}>下一页</button></div>`;
}
async function adminView(epoch) {
  if (!state.user) { loginNeeded('管理活动'); return; }
  if (state.user.role !== 'admin') {
    main.innerHTML = '<div class="page empty-view"><span class="eyebrow">ACCESS RESTRICTED</span><h2>这个空间，需要管理员身份。</h2><p>当前账号是普通用户。你可以查看自己的报名，或继续浏览公开活动。</p><a class="button" href="#my">查看我的报名</a><a class="text-button" href="#home">返回活动首页</a></div>';
    return;
  }
  main.innerHTML = '<div class="page loading-view" role="status">正在打开活动管理空间…</div>';
  const [stats,records] = await Promise.all([api('/api/admin/stats'),api('/api/admin/registrations?page='+state.adminPage)]);
  if (epoch !== state.routeEpoch) return;
  const eventRows = state.events.map(event => `<tr><td><strong>${esc(event.title)}</strong><small>${esc(event.category)}</small></td><td>${esc(date(event.starts_at))}</td><td>${esc(event.location)}</td><td>${esc(event.registered)} / ${esc(event.capacity)} 人</td><td><button class="button secondary small" data-action="edit-event" data-id="${esc(event.id)}" aria-label="编辑活动：${esc(event.title)}">编辑活动 ↗</button></td></tr>`).join('');
  const recordRows = records.registrations.map(record => `<tr><td><strong>${esc(record.display_name)}</strong><small>${esc(record.email)}</small></td><td>${esc(record.title)}</td><td class="mono">${esc(record.id)}</td><td>${esc(date(record.created_at))}</td><td><span class="badge green">已报名</span></td></tr>`).join('');
  main.innerHTML = `<div class="page"><div class="page-heading"><div><span class="eyebrow">MAKERS CLUB / WORKSPACE</span><h1>把活动，安排妥当。</h1><p>管理活动信息，查看每一位报名伙伴。</p></div><span class="badge green">管理员 · ${esc(state.user.display_name)}</span></div><section class="stat-grid" aria-label="管理概览"><div class="card stat"><span>已创建活动</span><strong>${esc(stats.events)}</strong></div><div class="card stat"><span>全部报名记录</span><strong>${esc(stats.registrations)}</strong></div><div class="card stat"><span>注册账号</span><strong>${esc(stats.users)}</strong></div></section><section class="card admin-panel"><div class="admin-toolbar"><div class="tabs" aria-label="管理内容"><button data-action="admin-tab" data-tab="events" aria-pressed="${state.adminTab === 'events'}">活动管理</button><button data-action="admin-tab" data-tab="registrations" aria-pressed="${state.adminTab === 'registrations'}">报名记录</button></div><button class="button small" data-action="new-event">＋ 创建活动</button></div>${state.adminTab === 'events' ? `<div class="table-wrap" role="region" aria-label="活动列表，可横向滚动" tabindex="0"><table><thead><tr><th scope="col">活动名称</th><th scope="col">活动时间 · 北京时间</th><th scope="col">活动地点</th><th scope="col">报名情况</th><th scope="col">操作</th></tr></thead><tbody>${eventRows}</tbody></table></div>` : `<div class="table-wrap" role="region" aria-label="所有报名记录，可横向滚动" tabindex="0"><table><thead><tr><th scope="col">报名人</th><th scope="col">活动</th><th scope="col">报名编号</th><th scope="col">报名时间</th><th scope="col">状态</th></tr></thead><tbody>${recordRows || '<tr><td colspan="5">还没有报名记录。</td></tr>'}</tbody></table></div>${pagination(records,'admin')}`}</section></div>`;
}
function openEventEditor(event = null) {
  const item = event || {title:'',subtitle:'',category:'共创工作坊',starts_at:'2026-11-28T14:00',location:'上海 · 演示创想空间 A',capacity:24,description:''};
  openDialog(`<div class="dialog-kicker">GIVE YOUR IDEA A PLACE</div><h2 class="dialog-title" id="dialog-title">${event ? '编辑活动信息' : '创建一场新活动'}</h2><p class="dialog-intro">保存后，活动信息会同步显示在公开活动页。</p><form id="event-form" data-id="${esc(event?.id || '')}" data-version="${esc(event?.version || '')}" novalidate>${field('title','活动名称',item.title,'text','maxlength="70" autofocus')}${field('subtitle','活动简介',item.subtitle,'text','maxlength="100"')}<div class="field-row">${field('category','活动类型',item.category,'text','maxlength="20"')}${field('capacity','活动名额',item.capacity,'number','min="1" max="1000" step="1"')}</div>${field('starts_at','活动时间（北京时间）',item.starts_at,'text','maxlength="16" placeholder="2026-11-28T14:00"')}${field('location','活动地点',item.location,'text','maxlength="100"')}<div class="field"><label for="field-description">活动说明</label><textarea id="field-description" name="description" maxlength="1600" aria-describedby="error-description">${esc(item.description)}</textarea><span class="field-error" id="error-description" data-error="description"></span></div><div class="form-error" role="alert" tabindex="-1" hidden></div><button class="button full" type="submit">保存活动 ↗</button></form>`,true);
}
async function memberAction(action,button) {
  if (action === 'login' || action === 'register') openAuth(action);
  else if (action === 'toggle-password') {
    const input = document.getElementById('field-password');
    const reveal = input.type === 'password'; input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? '隐藏' : '显示'; button.setAttribute('aria-label',reveal ? '隐藏密码' : '显示密码'); button.setAttribute('aria-pressed',String(reveal));
  } else if (action === 'logout') {
    if (button.dataset.busy === 'true') return;
    button.dataset.busy = 'true'; button.disabled = true;
    try { const result = await api('/api/auth/logout',{method:'POST',body:{}}); state.user = null; state.csrf = result.csrf; state.myPage = 1; state.receipt = null; state.pendingEvent = null; notify('已退出当前账号。'); if(location.hash === '#home') await renderRoute(); else location.hash = 'home'; }
    finally { button.disabled = false; button.dataset.busy = 'false'; }
  } else if (action === 'admin-tab') { state.adminTab = button.dataset.tab; await renderRoute(); }
  else if (action === 'new-event') openEventEditor();
  else if (action === 'edit-event') openEventEditor(byId(button.dataset.id));
  else if (action === 'record-detail') {
    const record = (await api('/api/registrations/'+encodeURIComponent(button.dataset.id))).registration;
    openDialog(`<div class="dialog-kicker">YOUR REGISTRATION</div><h2 class="dialog-title" id="dialog-title">这次相聚，已为你留位。</h2>${receiptLines(record)}<button class="button full" data-action="close-dialog">知道了</button>`);
  } else if (action === 'page') { if(button.dataset.scope === 'my') state.myPage = Number(button.dataset.page); else state.adminPage = Number(button.dataset.page); await renderRoute(); }
}
async function memberSubmit(event) {
  const form = event.target;
  if (form.id === 'auth-form') {
    event.preventDefault();
    const register = form.dataset.mode === 'register';
    const rules = {...(register ? {display_name:required('称呼',40)} : {}),email:emailRule,password:value => value.length >= 10 && value.length <= 128 ? '' : '密码需要10–128个字符。'};
    if (!validateForm(form,rules)) return;
    await submitForm(form,async () => {
      const body = {email:form.elements.email.value.trim(),password:form.elements.password.value};
      if(register) body.display_name = form.elements.display_name.value.trim();
      const result = await api('/api/auth/'+form.dataset.mode,{method:'POST',body});
      state.user = result.user; state.csrf = result.csrf; state.myPage = 1;
      const pending = state.pendingEvent; state.pendingEvent = null;
      closeDialog(true); await renderRoute();
      notify(register ? '账号已创建，现在可以报名了。' : '登录成功，欢迎回来。','success');
      if(pending) openSignup(pending);
    });
  } else if (form.id === 'event-form') {
    event.preventDefault();
    const rules = {title:required('活动名称',70),subtitle:required('活动简介',100),category:required('活动类型',20),capacity:value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1000 ? '' : '请填写1–1000之间的整数。',starts_at:value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? '' : '请按2026-11-28T14:00填写时间。',location:required('活动地点',100),description:required('活动说明',1600)};
    if(!validateForm(form,rules)) return;
    await submitForm(form,async () => {
      const body = Object.fromEntries(new FormData(form)); body.capacity = Number(body.capacity);
      if(form.dataset.id) body.version = Number(form.dataset.version);
      await api('/api/admin/events'+(form.dataset.id ? '/'+encodeURIComponent(form.dataset.id) : ''),{method:form.dataset.id ? 'PUT' : 'POST',body});
      closeDialog(true); await refreshEvents(); state.adminTab = 'events'; await renderRoute(); notify('活动已保存，公开活动页已同步。','success');
    });
  }
}

boot();
