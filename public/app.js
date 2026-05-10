const App = (() => {
  let pinValue = '';
  let currentUser = null;
  let empWeek   = getMonday(new Date());
  let adminWeek = getMonday(new Date());
  let planWeek  = getMonday(new Date());
  let employees = [];
  let pinModalTargetId = null;
  let reviewPending = null; // { id, status }

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
  function fmtDate(str) { const [,m,day] = str.split('-'); return `${day}.${m}.`; }
  function fmtDateFull(str) { const [y,m,day] = str.split('-'); return `${day}.${m}.${y}`; }
  function weekLabel(mon) { return `${fmtDate(toISO(mon))} – ${fmtDate(toISO(addDays(mon, 6)))}`; }
  function todayStr() { return new Date().toLocaleDateString('sv-SE'); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ─── Clock ────────────────────────────────────────────────────────────────
  function updateClock() {
    const el = document.getElementById('header-time');
    if (el) el.textContent = new Date().toLocaleTimeString('de-CH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
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
    pinValue += digit; updateDots(); hideError();
    if (pinValue.length === 4) setTimeout(submitPin, 100);
  }
  function pinDelete() { if (!pinValue.length) return; pinValue = pinValue.slice(0,-1); updateDots(); hideError(); }
  function hideError() { document.getElementById('pin-error').style.visibility = 'hidden'; }
  function showPinError() {
    document.getElementById('pin-error').style.visibility = 'visible';
    document.querySelector('.numpad').classList.add('shake');
    setTimeout(() => document.querySelector('.numpad').classList.remove('shake'), 400);
    pinValue = ''; updateDots();
  }

  async function submitPin() {
    try {
      const res = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ pin: pinValue }) });
      const data = await res.json();
      if (!res.ok || data.error) { showPinError(); return; }
      pinValue = ''; updateDots(); hideError();
      currentUser = data;

      if (data.type === 'admin') {
        document.getElementById('admin-greeting').textContent = `\u{1F451} ${data.name}`;
        adminWeek = planWeek = getMonday(new Date());
        employees = await (await fetch('/api/employees')).json();
        showScreen('admin');
        adminTab('calendar');
      } else {
        document.getElementById('emp-greeting').textContent = `\u{1F44B} ${data.name}`;
        empWeek = getMonday(new Date());
        showScreen('employee');
        loadEmpSchedule();
        loadEmpVacations();
        loadEmpAnnouncements();
        checkUnreadPopup();
      }
    } catch { showPinError(); }
  }

  function logout() { currentUser = null; pinValue = ''; updateDots(); hideError(); showScreen('pin'); }

  // ─── Employee: Schedule ───────────────────────────────────────────────────
  async function loadEmpSchedule() {
    const el = document.getElementById('emp-schedule');
    el.innerHTML = '<div class="loading">Lade...</div>';
    document.getElementById('emp-week-label').textContent = weekLabel(empWeek);
    try {
      const days = await (await fetch(`/api/schedule?week=${toISO(empWeek)}`)).json();
      const today = todayStr();
      el.innerHTML = days.map((day, i) => {
        const isT = day.date === today;
        const empsHtml = day.employees.map(e => {
          let time;
          if (e.is_vacation)               time = `<span class="schedule-time vacation">\u{1F3D6}&#65039; Ferien</span>`;
          else if (e.is_free)              time = `<span class="schedule-time free">Frei</span>`;
          else if (e.is_off || !e.start_time) time = `<span class="schedule-time off">&mdash;</span>`;
          else                             time = `<span class="schedule-time">${e.start_time}&thinsp;&ndash;&thinsp;${e.end_time} Uhr</span>`;
          const isMe = e.employee_id === currentUser.id;
          return `<div class="coworker-row${isMe ? ' coworker-me' : ''}">
            <span class="coworker-name">${esc(e.name)}${isMe ? ' <span class="me-badge">Ich</span>' : ''}</span>
            ${time}
          </div>`;
        }).join('');
        return `<div class="schedule-day-block${isT ? ' today-block' : ''}">
          <div class="schedule-day-header">
            <span class="schedule-day">${DAYS[i]}</span>
            <span class="schedule-date">${fmtDate(day.date)}</span>
            ${isT ? '<span class="today-badge">Heute</span>' : ''}
          </div>
          <div class="schedule-coworkers">${empsHtml}</div>
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
      if (!list.length) { el.innerHTML = '<div class="empty">Noch keine Anträge.</div>'; return; }
      el.innerHTML = list.map(v => {
        const cls   = v.status==='pending' ? 'badge-pending' : v.status==='approved' ? 'badge-approved' : 'badge-rejected';
        const label = v.status==='pending' ? '⏳ Ausstehend' : v.status==='approved' ? '✅ Genehmigt' : '❌ Abgelehnt';
        const meta  = v.status==='pending'
          ? '<div class="vacation-meta">Wartet auf Bestätigung von Eyup</div>'
          : v.reviewer_name ? `<div class="vacation-meta">Von ${esc(v.reviewer_name)} ${v.status==='approved' ? 'genehmigt' : 'abgelehnt'}</div>` : '';
        const adminNote = v.admin_note ? `<div class="admin-note">&#128172; ${esc(v.admin_note)}</div>` : '';
        return `<div class="vacation-item">
          <div class="vacation-header">
            <div>
              <div class="vacation-dates">${fmtDateFull(v.start_date)} &ndash; ${fmtDateFull(v.end_date)}</div>
              ${v.note ? `<div class="vacation-note">&ldquo;${esc(v.note)}&rdquo;</div>` : ''}
            </div>
            <span class="badge ${cls}">${label}</span>
          </div>
          ${meta}${adminNote}
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
      const res = await fetch('/api/vacations', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ employee_id:currentUser.id, start_date:start, end_date:end, note }) });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      showScreen('employee');
      loadEmpVacations();
      alert('Dein Antrag wurde gestellt und wartet auf Bestätigung!');
    } catch { alert('Fehler beim Stellen des Antrags.'); }
  }

  // ─── Employee: Announcements ──────────────────────────────────────────────
  async function loadEmpAnnouncements() {
    const el = document.getElementById('emp-announcements');
    if (!el) return;
    el.innerHTML = '<div class="loading">Lade...</div>';
    try {
      const list = await (await fetch('/api/announcements')).json();
      if (!list.length) { el.innerHTML = '<div class="empty">Keine Mitteilungen.</div>'; return; }
      el.innerHTML = list.map(a => `
        <div class="ann-item">
          <div class="ann-header">
            <span class="ann-title">${esc(a.title)}</span>
            <span class="ann-meta">${esc(a.admin_name || '')} &mdash; ${fmtDateFull(a.created_at.slice(0,10))}</span>
          </div>
          ${a.content ? `<div class="ann-content">${esc(a.content)}</div>` : ''}
          ${a.photo_data ? `<img class="ann-photo" src="${a.photo_data}" alt="Foto">` : ''}
        </div>`).join('');
      await fetch('/api/announcements/seen', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ employee_id: currentUser.id }) });
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  async function checkUnreadPopup() {
    try {
      const r = await (await fetch(`/api/announcements/unread?employee_id=${currentUser.id}`)).json();
      if (r.count > 0) {
        document.getElementById('unread-popup-title').textContent = r.count === 1 ? 'Neue Mitteilung!' : `${r.count} neue Mitteilungen!`;
        document.getElementById('unread-popup-text').textContent  = 'Die Admins haben eine Nachricht für dich hinterlassen.';
        document.getElementById('unread-popup').classList.add('open');
      }
    } catch {}
  }

  function dismissPopup() { document.getElementById('unread-popup').classList.remove('open'); }

  function goToAnnouncements() {
    dismissPopup();
    const el = document.getElementById('emp-announcements');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }

  // ─── Admin: Tabs ──────────────────────────────────────────────────────────
  function adminTab(tab) {
    const tabs = ['calendar','plan','vacations','employees','announcements'];
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', tabs[i] === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`admin-tab-${tab}`).classList.add('active');
    if (tab === 'calendar')      loadAdminCalendar();
    if (tab === 'plan')          loadPlanEditor();
    if (tab === 'vacations')     loadAdminVacations();
    if (tab === 'employees')     loadEmpList();
    if (tab === 'announcements') loadAdminAnnouncements();
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
        html += `<tr class="${isT ? 'cal-today' : ''}"><td class="day-col">${DAYS[i]}&nbsp;${fmtDate(day.date)}${isT ? ' &bull;' : ''}</td>`;
        employees.forEach(emp => {
          const e = day.employees.find(x => x.employee_id === emp.id);
          if (!e || e.is_off)       html += `<td class="cell-off">&mdash;</td>`;
          else if (e.is_vacation)   html += `<td class="cell-vacation">\u{1F3D6}&#65039; Ferien</td>`;
          else if (e.is_free)       html += `<td class="cell-free">Frei</td>`;
          else                      html += `<td class="cell-time">${e.start_time}&ndash;${e.end_time}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  function adminPrevWeek() { adminWeek = addDays(adminWeek, -7); loadAdminCalendar(); }
  function adminNextWeek() { adminWeek = addDays(adminWeek,  7); loadAdminCalendar(); }

  // ─── Admin: Week Plan Editor ───────────────────────────────────────────────
  async function loadPlanEditor() {
    const el = document.getElementById('plan-editor');
    el.innerHTML = '<div class="loading">Lade...</div>';
    document.getElementById('plan-week-label').textContent = weekLabel(planWeek);
    try {
      const saved = await (await fetch(`/api/plan?week=${toISO(planWeek)}`)).json();
      // map: [emp_id][dow] = { start, end, is_free }
      const map = {};
      employees.forEach(e => { map[e.id] = {}; });
      saved.forEach(s => { if (map[s.employee_id]) map[s.employee_id][s.day_of_week] = { start: s.start_time||'', end: s.end_time||'', is_free: s.is_free, is_vacation: s.is_vacation }; });

      let html = `<table class="tmpl-table"><thead><tr><th class="day-col">Tag</th>`;
      employees.forEach(e => { html += `<th>${esc(e.name)}</th>`; });
      html += '</tr></thead><tbody>';

      DAYS_FULL.forEach((dayName, dow) => {
        html += `<tr><td class="day-col">${dayName}</td>`;
        employees.forEach(emp => {
          const v = map[emp.id]?.[dow] || {};
          const isFree     = !!v.is_free;
          const isVacation = !!v.is_vacation;
          const disabled   = isFree || isVacation;
          html += `<td>
            <div class="plan-cell" id="cell_${emp.id}_${dow}">
              <div class="time-cell ${disabled ? 'time-disabled' : ''}">
                <input type="time" class="time-input" id="p_${emp.id}_${dow}_s" value="${disabled ? '' : (v.start||'')}" ${disabled ? 'disabled' : ''}>
                <input type="time" class="time-input" id="p_${emp.id}_${dow}_e" value="${disabled ? '' : (v.end||'')}"   ${disabled ? 'disabled' : ''}>
              </div>
              <label class="frei-check">
                <input type="checkbox" id="p_${emp.id}_${dow}_f" ${isFree ? 'checked' : ''} onchange="App.toggleFrei(${emp.id},${dow})"> Frei
              </label>
              <label class="frei-check">
                <input type="checkbox" id="p_${emp.id}_${dow}_v" ${isVacation ? 'checked' : ''} onchange="App.toggleFerien(${emp.id},${dow})"> Ferien
              </label>
            </div>
          </td>`;
        });
        html += '</tr>';
      });

      html += '</tbody></table>';
      el.innerHTML = html;
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  function toggleFrei(empId, dow) {
    const fb  = document.getElementById(`p_${empId}_${dow}_f`);
    const vb  = document.getElementById(`p_${empId}_${dow}_v`);
    const sIn = document.getElementById(`p_${empId}_${dow}_s`);
    const eIn = document.getElementById(`p_${empId}_${dow}_e`);
    const tc  = sIn.closest('.time-cell');
    if (fb.checked && vb) vb.checked = false;
    sIn.disabled = fb.checked; eIn.disabled = fb.checked;
    tc.classList.toggle('time-disabled', fb.checked);
    if (fb.checked) { sIn.value = ''; eIn.value = ''; }
  }

  function toggleFerien(empId, dow) {
    const fb  = document.getElementById(`p_${empId}_${dow}_f`);
    const vb  = document.getElementById(`p_${empId}_${dow}_v`);
    const sIn = document.getElementById(`p_${empId}_${dow}_s`);
    const eIn = document.getElementById(`p_${empId}_${dow}_e`);
    const tc  = sIn.closest('.time-cell');
    if (vb.checked && fb) fb.checked = false;
    sIn.disabled = vb.checked; eIn.disabled = vb.checked;
    tc.classList.toggle('time-disabled', vb.checked);
    if (vb.checked) { sIn.value = ''; eIn.value = ''; }
  }

  function planPrevWeek() { planWeek = addDays(planWeek, -7); loadPlanEditor(); }
  function planNextWeek() { planWeek = addDays(planWeek,  7); loadPlanEditor(); }

  async function savePlan() {
    const entries = [];
    let invalid = false;
    employees.forEach(emp => {
      DAYS.forEach((_, dow) => {
        const s       = document.getElementById(`p_${emp.id}_${dow}_s`)?.value || '';
        const e       = document.getElementById(`p_${emp.id}_${dow}_e`)?.value || '';
        const free    = document.getElementById(`p_${emp.id}_${dow}_f`)?.checked || false;
        const vacation = document.getElementById(`p_${emp.id}_${dow}_v`)?.checked || false;
        if (!free && !vacation && ((s && !e) || (!s && e))) { invalid = true; }
        entries.push({ employee_id: emp.id, day_of_week: dow, start_time: s||null, end_time: e||null, is_free: free, is_vacation: vacation });
      });
    });
    if (invalid) { alert('Bitte immer Von und Bis angeben, oder "Frei" ankreuzen, oder alles leer lassen.'); return; }
    try {
      const res = await fetch('/api/plan', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ week: toISO(planWeek), entries }) });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      alert(`Wochenplan für ${weekLabel(planWeek)} gespeichert!`);
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
        (v.status==='pending'  && showPending)  ||
        (v.status==='approved' && showApproved) ||
        (v.status==='rejected' && showRejected)
      );
      if (!list.length) { el.innerHTML = '<div class="empty">Keine Anträge vorhanden.</div>'; return; }
      el.innerHTML = list.map(v => {
        const cls   = v.status==='pending' ? 'badge-pending' : v.status==='approved' ? 'badge-approved' : 'badge-rejected';
        const label = v.status==='pending' ? '⏳ Ausstehend' : v.status==='approved' ? '✅ Genehmigt' : '❌ Abgelehnt';
        const reviewer = v.reviewer_name ? `<div class="vacation-meta">Von ${esc(v.reviewer_name)} ${v.status==='approved' ? 'genehmigt' : 'abgelehnt'}</div>` : '';
        const adminNote = v.admin_note ? `<div class="admin-note">&#128172; ${esc(v.admin_note)}</div>` : '';
        const actions = v.status === 'pending'
          ? `<div class="vacation-actions">
              <button class="btn btn-success btn-sm" onclick="App.reviewVacation(${v.id},'approved')">&#10003; Genehmigen</button>
              <button class="btn btn-danger  btn-sm" onclick="App.reviewVacation(${v.id},'rejected')">&#10007; Ablehnen</button>
             </div>`
          : v.status === 'approved'
          ? `<div class="vacation-actions">
              <button class="btn btn-danger btn-sm" onclick="App.reviewVacation(${v.id},'rejected')">&#10007; Ablehnen</button>
             </div>`
          : `<div class="vacation-actions">
              <button class="btn btn-success btn-sm" onclick="App.reviewVacation(${v.id},'approved')">&#10003; Genehmigen</button>
             </div>`;
        return `<div class="vacation-item">
          <div class="vacation-header">
            <div>
              <div class="vacation-dates"><strong>${esc(v.employee_name)}</strong>: ${fmtDateFull(v.start_date)} &ndash; ${fmtDateFull(v.end_date)}</div>
              ${v.note ? `<div class="vacation-note">&ldquo;${esc(v.note)}&rdquo;</div>` : ''}
            </div>
            <span class="badge ${cls}">${label}</span>
          </div>
          ${reviewer}${adminNote}${actions}
        </div>`;
      }).join('');
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  function reviewVacation(id, status) {
    reviewPending = { id, status };
    const isApprove = status === 'approved';
    document.getElementById('review-modal-title').textContent = isApprove ? '✅ Antrag genehmigen' : '❌ Antrag ablehnen';
    document.getElementById('review-modal-info').textContent  = isApprove ? 'Der Mitarbeiter wird informiert.' : 'Der Antrag wird abgelehnt.';
    const btn = document.getElementById('review-confirm-btn');
    btn.className = `btn btn-sm ${isApprove ? 'btn-success' : 'btn-danger'}`;
    btn.textContent = isApprove ? 'Genehmigen' : 'Ablehnen';
    document.getElementById('review-note').value = '';
    document.getElementById('review-modal').classList.add('open');
  }

  function closeReviewModal() { document.getElementById('review-modal').classList.remove('open'); reviewPending = null; }

  async function confirmReview() {
    if (!reviewPending) return;
    const admin_note = document.getElementById('review-note').value.trim();
    try {
      const res = await fetch(`/api/vacations/${reviewPending.id}`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ status: reviewPending.status, admin_id: currentUser.adminId, admin_note })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      closeReviewModal();
      loadAdminVacations();
    } catch { alert('Fehler.'); }
  }

  // ─── Admin: Announcements ─────────────────────────────────────────────────
  async function loadAdminAnnouncements() {
    const el = document.getElementById('ann-list');
    el.innerHTML = '<div class="loading">Lade...</div>';
    try {
      const list = await (await fetch('/api/announcements')).json();
      if (!list.length) { el.innerHTML = '<div class="empty">Noch keine Mitteilungen.</div>'; return; }
      el.innerHTML = list.map(a => `
        <div class="ann-item">
          <div class="ann-header">
            <span class="ann-title">${esc(a.title)}</span>
            <button class="del-rec-btn" onclick="App.deleteAnnouncement(${a.id})" title="Löschen">🗑️</button>
          </div>
          <span class="ann-meta">${esc(a.admin_name || '')} &mdash; ${fmtDateFull(a.created_at.slice(0,10))}</span>
          ${a.content ? `<div class="ann-content">${esc(a.content)}</div>` : ''}
          ${a.photo_data ? `<img class="ann-photo" src="${a.photo_data}" alt="Foto">` : ''}
        </div>`).join('');
    } catch { el.innerHTML = '<div class="empty">Fehler.</div>'; }
  }

  async function createAnnouncement() {
    const title   = document.getElementById('ann-title').value.trim();
    const content = document.getElementById('ann-content').value.trim();
    const file    = document.getElementById('ann-photo').files[0];
    if (!title) { alert('Bitte Titel eingeben.'); return; }

    let photo_data = null;
    if (file) {
      photo_data = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(file);
      });
    }

    try {
      const res = await fetch('/api/announcements', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ admin_id: currentUser.adminId, title, content: content||null, photo_data })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      document.getElementById('ann-title').value   = '';
      document.getElementById('ann-content').value = '';
      document.getElementById('ann-photo').value   = '';
      loadAdminAnnouncements();
    } catch { alert('Fehler beim Senden.'); }
  }

  async function deleteAnnouncement(id) {
    if (!confirm('Mitteilung wirklich löschen?')) return;
    try {
      await fetch(`/api/announcements/${id}`, { method:'DELETE' });
      loadAdminAnnouncements();
    } catch { alert('Fehler.'); }
  }

  // ─── Admin: Employees ─────────────────────────────────────────────────────
  async function loadEmpList() {
    const el = document.getElementById('emp-list');
    el.innerHTML = '<div class="loading">Lade...</div>';
    try {
      const list = await (await fetch('/api/employees/full')).json();
      if (!list.length) { el.innerHTML = '<div class="empty">Keine Mitarbeiter.</div>'; return; }
      el.innerHTML = list.map(e => `
        <div class="emp-row">
          <span class="emp-name">${esc(e.name)}</span>
          <span class="emp-pin">PIN: ${esc(e.pin)}</span>
          <button class="btn btn-secondary btn-sm" onclick="App.openPinModal(${e.id},'${esc(e.name)}')">&#9999;&#65039; PIN</button>
          <button class="btn btn-danger btn-sm" onclick="App.deleteEmployee(${e.id},'${esc(e.name)}')">&#128465;&#65039;</button>
        </div>`).join('');
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  function showAddEmpForm() {
    document.getElementById('add-emp-form').style.display = 'block';
    document.getElementById('show-add-emp-btn').style.display = 'none';
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-pin').value  = '';
  }
  function hideAddEmpForm() {
    document.getElementById('add-emp-form').style.display = 'none';
    document.getElementById('show-add-emp-btn').style.display = 'block';
  }

  async function addEmployee() {
    const name = document.getElementById('new-emp-name').value.trim();
    const pin  = document.getElementById('new-emp-pin').value.trim();
    if (!name) { alert('Bitte Namen eingeben.'); return; }
    if (!/^\d{4}$/.test(pin)) { alert('PIN muss genau 4 Ziffern sein.'); return; }
    try {
      const res = await fetch('/api/employees', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name, pin }) });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      hideAddEmpForm();
      employees = await (await fetch('/api/employees')).json();
      loadEmpList();
    } catch { alert('Fehler beim Hinzufügen.'); }
  }

  async function deleteEmployee(id, name) {
    if (!confirm(`Mitarbeiter "${name}" wirklich löschen?\nAlle zugehörigen Plandaten werden entfernt.`)) return;
    try {
      const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      employees = await (await fetch('/api/employees')).json();
      loadEmpList();
    } catch { alert('Fehler beim Löschen.'); }
  }

  function openPinModal(id, name) {
    pinModalTargetId = id;
    document.getElementById('pin-modal-title').textContent = `PIN ändern — ${name}`;
    document.getElementById('pin-modal-input').value = '';
    document.getElementById('pin-modal').classList.add('open');
    setTimeout(() => document.getElementById('pin-modal-input').focus(), 100);
  }
  function closePinModal() { document.getElementById('pin-modal').classList.remove('open'); pinModalTargetId = null; }

  async function savePin() {
    const pin = document.getElementById('pin-modal-input').value.trim();
    if (!/^\d{4}$/.test(pin)) { alert('PIN muss genau 4 Ziffern sein.'); return; }
    try {
      const res = await fetch(`/api/employees/${pinModalTargetId}/pin`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ pin }) });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      closePinModal();
      loadEmpList();
    } catch { alert('Fehler beim Ändern.'); }
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
    planPrevWeek, planNextWeek, savePlan, toggleFrei, toggleFerien,
    loadAdminVacations, reviewVacation, closeReviewModal, confirmReview,
    showAddEmpForm, hideAddEmpForm, addEmployee, deleteEmployee,
    openPinModal, closePinModal, savePin,
    createAnnouncement, deleteAnnouncement,
    dismissPopup, goToAnnouncements
  };
})();
