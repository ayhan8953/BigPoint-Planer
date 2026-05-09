const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN fehlt' });
    const result = await db.login(pin);
    if (!result) return res.status(401).json({ error: 'Falsche PIN' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/employees', async (req, res) => {
  try { res.json(await db.getEmployees()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/employees/full', async (req, res) => {
  try { res.json(await db.getEmployeesWithPins()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employees', async (req, res) => {
  try {
    const { name, pin } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN muss 4 Ziffern sein' });
    const all = await db.getEmployees();
    if (all.find(e => e.name.toLowerCase() === name.trim().toLowerCase()))
      return res.status(400).json({ error: 'Mitarbeiter existiert bereits' });
    if (await db.isPinTaken(pin))
      return res.status(400).json({ error: 'Diese PIN ist bereits vergeben' });
    const emp = await db.addEmployee(name.trim(), pin);
    res.json(emp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/employees/:id/pin', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { pin } = req.body;
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN muss 4 Ziffern sein' });
    if (await db.isPinTaken(pin, id))
      return res.status(400).json({ error: 'Diese PIN ist bereits vergeben' });
    await db.updateEmployeePin(id, pin);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/plan', async (req, res) => {
  try {
    const { week } = req.query;
    if (!week) return res.status(400).json({ error: 'week fehlt' });
    res.json(await db.getWeekPlan(week));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/plan', async (req, res) => {
  try {
    const { week, entries } = req.body;
    if (!week || !Array.isArray(entries)) return res.status(400).json({ error: 'Ungueltige Daten' });
    await db.saveWeekPlan(week, entries);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/schedule', async (req, res) => {
  try {
    let monday = req.query.week;
    if (!monday) {
      const now = new Date();
      const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() + diff);
      monday = mon.toLocaleDateString('sv-SE');
    }
    res.json(await db.getWeekSchedule(monday));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vacations', async (req, res) => {
  try {
    const { employee_id } = req.query;
    res.json(await db.getVacations(employee_id ? parseInt(employee_id) : null));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vacations', async (req, res) => {
  try {
    const { employee_id, start_date, end_date, note } = req.body;
    if (!employee_id || !start_date || !end_date) return res.status(400).json({ error: 'Fehlende Felder' });
    if (end_date < start_date) return res.status(400).json({ error: 'Enddatum vor Startdatum' });
    const v = await db.submitVacation(employee_id, start_date, end_date, note);
    res.json(v);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vacations/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, admin_id, admin_note } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Ungueltiger Status' });
    if (!admin_id) return res.status(400).json({ error: 'admin_id fehlt' });
    await db.reviewVacation(id, status, admin_id, admin_note);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/announcements', async (req, res) => {
  try { res.json(await db.getAnnouncements()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/announcements', async (req, res) => {
  try {
    const { admin_id, title, content, photo_data } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Titel erforderlich' });
    if (!admin_id) return res.status(400).json({ error: 'admin_id fehlt' });
    const a = await db.createAnnouncement(admin_id, title.trim(), content, photo_data);
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/announcements/:id', async (req, res) => {
  try { await db.deleteAnnouncement(parseInt(req.params.id)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/announcements/unread', async (req, res) => {
  try {
    const { employee_id } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'employee_id fehlt' });
    res.json({ count: await db.getUnreadCount(parseInt(employee_id)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/announcements/seen', async (req, res) => {
  try {
    const { employee_id } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'employee_id fehlt' });
    await db.markSeen(employee_id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function start() {
  await db.init();
  app.listen(PORT, '0.0.0.0', () => {
    const mode = process.env.DATABASE_URL ? 'PostgreSQL (Cloud)' : 'JSON (Lokal)';
    console.log(`\n  BigPoint Planer laeuft auf http://localhost:${PORT}  [${mode}]\n`);
  });
}

start().catch(err => { console.error('Startfehler:', err); process.exit(1); });
