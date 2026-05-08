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

app.get('/api/template', async (req, res) => {
  try { res.json(await db.getTemplate()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/template', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'Ungueltige Daten' });
    await db.saveTemplate(entries);
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
    const { status, admin_id } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Ungueltiger Status' });
    if (!admin_id) return res.status(400).json({ error: 'admin_id fehlt' });
    await db.reviewVacation(id, status, admin_id);
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
