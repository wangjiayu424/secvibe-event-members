/* Shared form, feedback and modal ownership for both filming snapshots. */
'use strict';
window.UI = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let toastTimer;
  let dialogDirty = false;
  let trackDirty = false;
  let returnFocus = null;
  const dialog = () => document.getElementById('main-dialog');
  function notify(message, tone = 'info') {
    const node = document.getElementById('toast');
    clearTimeout(toastTimer);
    node.textContent = message;
    node.dataset.tone = tone;
    node.hidden = false;
    toastTimer = setTimeout(() => { node.hidden = true; }, 5000);
  }
  function openDialog(html, dirty = false) {
    if (dialog().open) dialog().close();
    returnFocus = document.activeElement;
    document.getElementById('dialog-content').innerHTML = html;
    document.getElementById('discard-prompt').hidden = true;
    dialogDirty = false;
    trackDirty = dirty;
    dialog().showModal();
    document.body.classList.add('dialog-open');
    const target = dialog().querySelector('[autofocus]') || dialog().querySelector('input, textarea') || dialog().querySelector('button');
    if (target) target.focus();
  }
  function closeDialog(force = false) {
    if (trackDirty && dialogDirty && !force) {
      document.getElementById('discard-prompt').hidden = false;
      document.getElementById('discard-prompt').querySelector('button[value="continue"]').focus();
      return;
    }
    dialogDirty = false;
    dialog().close();
  }
  function clearErrors(form) {
    form.querySelectorAll('.field-error').forEach(n => { n.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(n => n.removeAttribute('aria-invalid'));
    const summary = form.querySelector('.form-error');
    if (summary) { summary.textContent = ''; summary.hidden = true; }
  }
  function fieldError(form, name, message) {
    const field = form.elements.namedItem(name);
    const error = form.querySelector(`[data-error="${name}"]`);
    if (field && error) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', error.id);
      error.textContent = message;
      field.focus();
    } else {
      const summary = form.querySelector('.form-error');
      if (summary) { summary.textContent = message; summary.hidden = false; summary.focus(); }
    }
  }
  function validateForm(form, rules) {
    clearErrors(form);
    for (const [name, validate] of Object.entries(rules)) {
      const input = form.elements.namedItem(name);
      const message = validate(input?.value ?? '');
      if (message) { fieldError(form, name, message); return false; }
    }
    return true;
  }
  async function submitForm(form, task) {
    if (form.dataset.busy === 'true') return;
    form.dataset.busy = 'true';
    const button = form.querySelector('[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = '正在提交…';
    form.setAttribute('aria-busy', 'true');
    try { await task(); }
    catch (error) { fieldError(form, error.field, error.message || '暂时无法完成，请重试。'); }
    finally {
      form.dataset.busy = 'false';
      form.removeAttribute('aria-busy');
      button.disabled = false;
      button.textContent = label;
    }
  }
  function field(name, label, value = '', type = 'text', options = '') {
    return `<div class="field"><label for="field-${esc(name)}">${esc(label)}</label><input id="field-${esc(name)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" aria-describedby="error-${esc(name)}" ${options}><span class="field-error" id="error-${esc(name)}" data-error="${esc(name)}"></span></div>`;
  }
  const emailRule = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254 ? '' : '请填写有效的邮箱地址。';
  const required = (label, max = 100) => value => value.trim() && value.trim().length <= max ? '' : `请填写${label}，不超过${max}个字符。`;
  const date = stamp => new Intl.DateTimeFormat('zh-CN', {month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Shanghai'}).format(new Date(stamp.length === 16 ? stamp + ':00+08:00' : stamp));
  document.addEventListener('input', event => {
    if (dialog().contains(event.target) && trackDirty) dialogDirty = true;
    if(event.target.getAttribute('aria-invalid') === 'true') {
      event.target.removeAttribute('aria-invalid');
      const errorId = event.target.getAttribute('aria-describedby');
      const error = errorId ? document.getElementById(errorId) : null;
      if(error?.classList.contains('field-error')) error.textContent = '';
    }
  });
  dialog().addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  document.getElementById('dialog-close-form').addEventListener('submit', event => { event.preventDefault(); closeDialog(); });
  document.getElementById('discard-prompt').addEventListener('submit', event => {
    event.preventDefault();
    if(event.submitter?.value === 'discard') closeDialog(true);
    else {
      document.getElementById('discard-prompt').hidden = true;
      const target = dialog().querySelector('input, textarea');
      if(target) target.focus();
    }
  });
  dialog().addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
    if (returnFocus?.isConnected) returnFocus.focus();
  });
  window.addEventListener('beforeunload', event => { if (trackDirty && dialogDirty && dialog().open) { event.preventDefault(); event.returnValue = ''; } });
  return {esc, notify, openDialog, closeDialog, field, fieldError, clearErrors, validateForm, submitForm, emailRule, required, date};
})();
