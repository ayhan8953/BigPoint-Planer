const App = (() => {
  let pinValue = '';
  let currentUser = null;
  let empWeek = getMonday(new Date());
  let adminWeek = getMonday(new Date());
  let employees = [];

  const DAYS      = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  const DAYS_FULL = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];

  function getMonday(d) {
    const dt = new Date(d);
    const day = dt.getDay();
    dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

  function toISO(d) { return d.toLocaleDateString('sv-SE'); }

  function fmtDate(str) {
    const [, m, day] = str.split('-');
    return `${day}.${m}.`;
  }

  function fmtDateFull(str) {
    const [y, m, day] = str.split('-');
    return `${day}.${m}.${y}`;
  }

  function weekLabel(mon) {
    return `${fmtDate(toISO(mon))} – ${fmtDate(toISO(addDays(mon, 6)))}`;
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function todayStr() { return new Date().toLocaleDateString('sv-SE'); }

  // ─── Clock ────────────────────────────────────────────────────────────────
  function updateClock() {
    const el = document.getElementById('header-time');
    if (el) el.textContent = new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ─── Screens ──────────────────────────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
  }

  // ─── PIN ──────────────────────────────────────────────────────────────────
  function updateDots() {
    document.querySelectorAll('#pin-dots .dot').forEach((d, i) => d.classList.toggle('filled', i < pinValue.length));
  }

  function pinPress(digit) {
    if (pinValue.length >= 4) return;
    pinValue += digit;
    updateDots();
    hideError();
    if (pinValue.length === 4) setTimeout(submitPin, 100);
  }

  function pinDelete() {
    if (!pinValue.length) return;
    pinValue = pinValue.slice(0, -1);
    updateDots();
    hideError();
  }

  function hideError() { document.getElementById('pin-error').style.visibility = 'hidden'; }

  function showPinError() {
    document.getElementById('pin-error').style.visibility = 'visible';
    document.querySelector('.numpad').classList.add('shake');
    setTimeout(() => document.querySelector('.numpad').classList.remove('shake'), 400);
    pinValue = '';
    updateDots();
  }

  async function submitPin() {
    try {
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinValue })
      });
      const data = await res.json();
      if (!res.ok || data.error) { showPinError(); return; }

      pinValue = ''; updateDots(); hideError();
      currentUser = data;

      if (data.type === 'admin') {
        document.getElementById('admin-greeting').textContent = `\u{1F451} ${data.name}`;
        adminWeek = getMonday(new Date());
        employees = await (await fetch('/api/employees')).json();
        showScreen('admin');
        adminTab('calendar');
      } else {
        document.getElementById('emp-greeting').textContent = `\u{1F44B} ${data.name}`;
        empWeek = getMonday(new Date());
        showScreen('employee');
        loadEmpSchedule();
        loadEmpVacations();
      }
    } catch { showPinError(); }
  }

  function logout() {
    currentUser = null; pinValue = ''; updateDots(); hideError();
    showScreen('pin');
  }

  // ─── Employee: Schedule ───────────────────────────────────────────────────
  async function loadEmpSchedule() {
    const el = document.getElementById('emp-schedule');
    el.innerHTML = '<div class="loading">Lade...</div>';
    document.getElementById('emp-week-label').textContent = weekLabel(empWeek);

    try {
      const days = await (await fetch(`/api/schedule?week=${toISO(empWeek)}`)).json();
      const today = todayStr();

      el.innerHTML = days.map((day, i) => {
        const e = day.employees.find(x => x.employee_id === currentUser.id);
        if (!e) return '';
        let time;
        if (e.is_vacation)         time = `<span class="schedule-time vacation">\u{1F3D6}️ Ferien</span>`;
        else if (e.is_off || !e.start_time) time = `<span class="schedule-time off">&mdash;</span>`;
        else                        time = `<span class="schedule-time">${e.start_time}&thinsp;&ndash;&thinsp;${e.end_time} Uhr</span>`;
        const isT = day.date === today;
        return `<div class="schedule-row ${isT ? 'today-row' : ''}">
          <span class="schedule-day">${DAYS[i]}</span>
          <span class="schedule-date">${fmtDate(day.date)}</span>
          ${time}
          ${isT ? '<span class="today-badge">Heute</span>' : ''}
        </div>`;
      }).join('');
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  function prevWeek() { empWeek = addDays(empWeek, -7); loadEmpSchedule(); }
  function nextWeek() { empWeek = addDays(empWeek,  7); loadEmpSchedule(); }

  // ─── Employee: Vacations ──────────────────────────────────────────────────
  async function loadEmpVacations() {
    const el = document.getElementById('emp-vacations');
    el.innerHTML = '<div class="loading">Lade...</div>';
    try {
      const list = await (await fetch(`/api/vacations?employee_id=${currentUser.id}`)).json();
      if (!list.length) { el.innerHTML = '<div class="empty">Noch keine Antraege.</div>'; return; }
      el.innerHTML = list.map(v => {
        const cls   = v.status === 'pending' ? 'badge-pending' : v.status === 'approved' ? 'badge-approved' : 'badge-rejected';
        const label = v.status === 'pending' ? '⏳ Ausstehend' : v.status === 'approved' ? '✅ Genehmigt' : '❌ Abgelehnt';
        const meta  = v.status === 'pending'
          ? 'Wartet auf Bestaetigung von Eyup'
          : v.reviewer_name ? `Von ${esc(v.reviewer_name)} ${v.status === 'approved' ? 'genehmigt' : 'abgelehnt'}` : '';
        return `<div class="vacation-item">
          <div class="vacation-header">
            <div>
              <div class="vacation-dates">${fmtDateFull(v.start_date)} &ndash; ${fmtDateFull(v.end_date)}</div>
              ${v.note ? `<div class="vacation-note">&ldquo;${esc(v.note)}&rdquo;</div>` : ''}
            </div>
            <span class="badge ${cls}">${label}</span>
          </div>
          ${meta ? `<div class="vacation-meta">${esc(meta)}</div>` : ''}
        </div>`;
      }).join('');
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  function showVacationForm() {
    const today = todayStr();
    document.getElementById('vac-start').value = today;
    document.getElementById('vac-end').value   = today;
    document.getElementById('vac-note').value  = '';
    showScreen('vacation');
  }

  async function submitVacation() {
    const start = document.getElementById('vac-start').value;
    const end   = document.getElementById('vac-end').value;
    const note  = document.getElementById('vac-note').value.trim();
    if (!start || !end) { alert('Bitte Datum eingeben.'); return; }
    if (end < start)    { alert('Enddatum muss nach Startdatum liegen.'); return; }
    try {
      const res = await fetch('/api/vacations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: currentUser.id, start_date: start, end_date: end, note })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      showScreen('employee');
      loadEmpVacations();
      alert('Dein Antrag wurde gestellt und wartet auf Bestaetigung!');
    } catch { alert('Fehler beim Stellen des Antrags.'); }
  }

  // ─── Admin: Tabs ──────────────────────────────────────────────────────────
  function adminTab(tab) {
    const tabs = ['calendar', 'template', 'vacations'];
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', tabs[i] === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`admin-tab-${tab}`).classList.add('active');
    if (tab === 'calendar')  loadAdminCalendar();
    if (tab === 'template')  loadTemplateEditor();
    if (tab === 'vacations') loadAdminVacations();
  }

  // ─── Admin: Calendar ──────────────────────────────────────────────────────
  async function loadAdminCalendar() {
    const el = document.getElementById('admin-calendar');
    el.innerHTML = '<div class="loading">Lade...</div>';
    document.getElementById('admin-week-label').textContent = weekLabel(adminWeek);
    try {
      const days  = await (await fetch(`/api/schedule?week=${toISO(adminWeek)}`)).json();
      const today = todayStr();

      let html = `<table class="cal-table"><thead><tr><th class="day-col">Tag</th>`;
      employees.forEach(e => { html += `<th>${esc(e.name)}</th>`; });
      html += '</tr></thead><tbody>';

      days.forEach((day, i) => {
        const isT = day.date === today;
        html += `<tr class="${isT ? 'cal-today' : ''}">
          <td class="day-col">${DAYS[i]}&nbsp;${fmtDate(day.date)}${isT ? ' &bull;' : ''}</td>`;
        employees.forEach(emp => {
          const e = day.employees.find(x => x.employee_id === emp.id);
          if (!e || e.is_off || (!e.is_vacation && !e.start_time)) {
            html += `<td class="cell-off">&mdash;</td>`;
          } else if (e.is_vacation) {
            html += `<td class="cell-vacation">\u{1F3D6}️</td>`;
          } else {
            html += `<td class="cell-time">${e.start_time}&ndash;${e.end_time}</td>`;
          }
        });
        html += '</tr>';
      });

      html += '</tbody></table>';
      el.innerHTML = html;
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  function adminPrevWeek() { adminWeek = addDays(adminWeek, -7); loadAdminCalendar(); }
  function adminNextWeek() { adminWeek = addDays(adminWeek,  7); loadAdminCalendar(); }

  // ─── Admin: Template Editor ───────────────────────────────────────────────
  async function loadTemplateEditor() {
    const el = document.getElementById('template-editor');
    el.innerHTML = '<div class="loading">Lade...</div>';
    try {
      const tmpl = await (await fetch('/api/template')).json();
      // map: [emp_id][dow] = { start, end }
      const map = {};
      employees.forEach(e => { map[e.id] = {}; });
      tmpl.forEach(t => { if (map[t.employee_id]) map[t.employee_id][t.day_of_week] = { start: t.start_time || '', end: t.end_time || '' }; });

      let html = `<table class="tmpl-table"><thead><tr><th class="day-col">Tag</th>`;
      employees.forEach(e => { html += `<th>${esc(e.name)}</th>`; });
      html += '</tr></thead><tbody>';

      DAYS_FULL.forEach((dayName, dow) => {
        html += `<tr><td class="day-col">${dayName}</td>`;
        employees.forEach(emp => {
          const v = map[emp.id]?.[dow] || {};
          html += `<td><div class="time-cell">
            <input type="time" class="time-input" id="t_${emp.id}_${dow}_s" value="${v.start || ''}">
            <input type="time" class="time-input" id="t_${emp.id}_${dow}_e" value="${v.end   || ''}">
          </div></td>`;
        });
        html += '</tr>';
      });

      html += '</tbody></table>';
      el.innerHTML = html;
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  async function saveTemplate() {
    const entries = [];
    let invalid = false;
    employees.forEach(emp => {
      DAYS.forEach((_, dow) => {
        const s = document.getElementById(`t_${emp.id}_${dow}_s`)?.value || '';
        const e = document.getElementById(`t_${emp.id}_${dow}_e`)?.value || '';
        if ((s && !e) || (!s && e)) { invalid = true; }
        entries.push({ employee_id: emp.id, day_of_week: dow, start_time: s || null, end_time: e || null });
      });
    });
    if (invalid) { alert('Bitte immer beide Zeiten angeben (Von und Bis), oder beide leer lassen.'); return; }
    try {
      const res = await fetch('/api/template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      alert('Vorlage gespeichert!');
    } catch { alert('Fehler beim Speichern.'); }
  }

  // ─── Admin: Vacations ─────────────────────────────────────────────────────
  async function loadAdminVacations() {
    const el = document.getElementById('admin-vacations');
    el.innerHTML = '<div class="loading">Lade...</div>';
    const showPending  = document.getElementById('filter-pending')?.checked;
    const showApproved = document.getElementById('filter-approved')?.checked;
    const showRejected = document.getElementById('filter-rejected')?.checked;

    try {
      const all  = await (await fetch('/api/vacations')).json();
      const list = all.filter(v =>
        (v.status === 'pending'  && showPending)  ||
        (v.status === 'approved' && showApproved) ||
        (v.status === 'rejected' && showRejected)
      );

      if (!list.length) { el.innerHTML = '<div class="empty">Keine Antraege vorhanden.</div>'; return; }

      el.innerHTML = list.map(v => {
        const cls   = v.status === 'pending' ? 'badge-pending' : v.status === 'approved' ? 'badge-approved' : 'badge-rejected';
        const label = v.status === 'pending' ? '⏳ Ausstehend' : v.status === 'approved' ? '✅ Genehmigt' : '❌ Abgelehnt';
        const actions = v.status === 'pending' ? `
          <div class="vacation-actions">
            <button class="btn btn-success btn-sm" onclick="App.reviewVacation(${v.id},'approved')">✅ Genehmigen</button>
            <button class="btn btn-danger  btn-sm" onclick="App.reviewVacation(${v.id},'rejected')">❌ Ablehnen</button>
          </div>` : '';
        const reviewer = v.reviewer_name ? `<div class="vacation-meta">Von ${esc(v.reviewer_name)} ${v.status === 'approved' ? 'genehmigt' : 'abgelehnt'}</div>` : '';
        return `<div class="vacation-item">
          <div class="vacation-header">
            <div>
              <div class="vacation-dates"><strong>${esc(v.employee_name)}</strong>: ${fmtDateFull(v.start_date)} &ndash; ${fmtDateFull(v.end_date)}</div>
              ${v.note ? `<div class="vacation-note">&ldquo;${esc(v.note)}&rdquo;</div>` : ''}
            </div>
            <span class="badge ${cls}">${label}</span>
          </div>
          ${reviewer}
          ${actions}
        </div>`;
      }).join('');
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  async function reviewVacation(id, status) {
    const label = status === 'approved' ? 'genehmigen' : 'ablehnen';
    if (!confirm(`Antrag wirklich ${label}?`)) return;
    try {
      const res = await fetch(`/api/vacations/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, admin_id: currentUser.adminId })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      loadAdminVacations();
    } catch { alert('Fehler.'); }
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const screen = document.querySelector('.screen.active');
    if (!screen || screen.id !== 'screen-pin') return;
    if (e.key >= '0' && e.key <= '9') pinPress(e.key);
    else if (e.key === 'Backspace') pinDelete();
  });

  // ─── Init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    showScreen('pin');
  });

  return {
    pinPress, pinDelete, logout, showScreen,
    prevWeek, nextWeek, showVacationForm, submitVacation,
    adminPrevWeek, adminNextWeek, adminTab,
    saveTemplate, loadAdminVacations, reviewVacation
  };
})();
