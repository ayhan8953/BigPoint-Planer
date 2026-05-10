const path = require('path');
const fs = require('fs');

const USE_PG = !!process.env.DATABASE_URL;

const DATA_DIR = path.join(__dirname, 'data');
const FILES = {
  admins:        path.join(DATA_DIR, 'admins.json'),
  employees:     path.join(DATA_DIR, 'employees.json'),
  weekplans:     path.join(DATA_DIR, 'weekplans.json'),
  vacations:     path.join(DATA_DIR, 'vacations.json'),
  announcements: path.join(DATA_DIR, 'announcements.json'),
  seen:          path.join(DATA_DIR, 'seen.json'),
};

function rj(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function wj(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function nextId(arr) { return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id)) + 1; }

function isoDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toLocaleDateString('sv-SE');
}

let pool;
if (USE_PG) {
  const { Pool, types } = require('pg');
  types.setTypeParser(1082, v => v);
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

const db = {
  async init() {
    if (USE_PG) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          pin TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS employees (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          pin TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS week_plans (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          week_monday DATE NOT NULL,
          day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
          start_time TIME,
          end_time TIME,
          is_free BOOLEAN NOT NULL DEFAULT FALSE,
          is_vacation BOOLEAN NOT NULL DEFAULT FALSE,
          UNIQUE(employee_id, week_monday, day_of_week)
        );
        CREATE TABLE IF NOT EXISTS announcements (
          id SERIAL PRIMARY KEY,
          admin_id INTEGER REFERENCES admins(id),
          title TEXT NOT NULL,
          content TEXT,
          photo_data TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS employee_seen (
          employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
          last_seen_at TIMESTAMPTZ DEFAULT '2000-01-01'
        );
        CREATE TABLE IF NOT EXISTS vacation_requests (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          note TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          reviewed_by INTEGER REFERENCES admins(id),
          reviewed_at TIMESTAMPTZ,
          admin_note TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      // Migrate: add admin_note if missing (for existing DBs)
      await pool.query(`ALTER TABLE vacation_requests ADD COLUMN IF NOT EXISTS admin_note TEXT;`).catch(() => {});
      await pool.query(`ALTER TABLE week_plans ADD COLUMN IF NOT EXISTS is_vacation BOOLEAN NOT NULL DEFAULT FALSE;`).catch(() => {});
      await pool.query(`
        INSERT INTO admins (id, name, pin) VALUES (1,'Eyup','0000'),(2,'Ayhan','1627') ON CONFLICT (id) DO NOTHING;
        INSERT INTO employees (name, pin) VALUES ('Shafiq','1111'),('Sadat','2222'),('Mohammed','3333') ON CONFLICT (name) DO NOTHING;
      `);
    } else {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(FILES.admins))    wj(FILES.admins,    [{ id: 1, name: 'Eyup', pin: '0000' }, { id: 2, name: 'Ayhan', pin: '1627' }]);
      if (!fs.existsSync(FILES.employees)) wj(FILES.employees, [{ id: 1, name: 'Shafiq', pin: '1111' }, { id: 2, name: 'Sadat', pin: '2222' }, { id: 3, name: 'Mohammed', pin: '3333' }]);
      if (!fs.existsSync(FILES.weekplans))     wj(FILES.weekplans,     []);
      if (!fs.existsSync(FILES.vacations))     wj(FILES.vacations,     []);
      if (!fs.existsSync(FILES.announcements)) wj(FILES.announcements, []);
      if (!fs.existsSync(FILES.seen))          wj(FILES.seen,          {});
    }
  },

  async login(pin) {
    if (USE_PG) {
      const a = await pool.query('SELECT * FROM admins WHERE pin=$1', [pin]);
      if (a.rows[0]) return { type: 'admin', name: a.rows[0].name, adminId: a.rows[0].id };
      const e = await pool.query('SELECT id, name FROM employees WHERE pin=$1', [pin]);
      if (e.rows[0]) return { type: 'employee', id: e.rows[0].id, name: e.rows[0].name };
      return null;
    }
    const admin = rj(FILES.admins, []).find(a => a.pin === pin);
    if (admin) return { type: 'admin', name: admin.name, adminId: admin.id };
    const emp = rj(FILES.employees, []).find(e => e.pin === pin);
    if (emp) return { type: 'employee', id: emp.id, name: emp.name };
    return null;
  },

  async getEmployees() {
    if (USE_PG) {
      const r = await pool.query('SELECT id, name FROM employees ORDER BY name');
      return r.rows;
    }
    return rj(FILES.employees, []).sort((a, b) => a.name.localeCompare(b.name)).map(e => ({ id: e.id, name: e.name }));
  },

  async getEmployeesWithPins() {
    if (USE_PG) {
      const r = await pool.query('SELECT id, name, pin FROM employees ORDER BY name');
      return r.rows;
    }
    return rj(FILES.employees, []).sort((a, b) => a.name.localeCompare(b.name));
  },

  async isPinTaken(pin, excludeId = null) {
    if (USE_PG) {
      const a = await pool.query('SELECT pin FROM admins');
      if (a.rows.some(r => r.pin === pin)) return true;
      const q = excludeId ? 'SELECT id FROM employees WHERE pin=$1 AND id!=$2' : 'SELECT id FROM employees WHERE pin=$1';
      const r = await pool.query(q, excludeId ? [pin, excludeId] : [pin]);
      return r.rows.length > 0;
    }
    if (rj(FILES.admins, []).some(a => a.pin === pin)) return true;
    return rj(FILES.employees, []).some(e => e.pin === pin && e.id !== excludeId);
  },

  async addEmployee(name, pin) {
    if (USE_PG) {
      const r = await pool.query('INSERT INTO employees (name, pin) VALUES ($1,$2) RETURNING id, name', [name, pin]);
      return r.rows[0];
    }
    const emps = rj(FILES.employees, []);
    const emp = { id: nextId(emps), name, pin };
    emps.push(emp); wj(FILES.employees, emps);
    return { id: emp.id, name: emp.name };
  },

  async deleteEmployee(id) {
    if (USE_PG) { await pool.query('DELETE FROM employees WHERE id=$1', [id]); return; }
    wj(FILES.employees, rj(FILES.employees, []).filter(e => e.id !== id));
    wj(FILES.weekplans, rj(FILES.weekplans, []).filter(e => e.employee_id !== id));
    wj(FILES.vacations, rj(FILES.vacations, []).filter(v => v.employee_id !== id));
    const seen = rj(FILES.seen, {}); delete seen[id]; wj(FILES.seen, seen);
  },

  async updateEmployeePin(id, pin) {
    if (USE_PG) { await pool.query('UPDATE employees SET pin=$1 WHERE id=$2', [pin, id]); return; }
    const emps = rj(FILES.employees, []);
    const i = emps.findIndex(e => e.id === id);
    if (i >= 0) { emps[i].pin = pin; wj(FILES.employees, emps); }
  },

  async getWeekPlan(mondayStr) {
    if (USE_PG) {
      const r = await pool.query(`
        SELECT wp.employee_id, e.name, wp.day_of_week,
               to_char(wp.start_time,'HH24:MI') as start_time,
               to_char(wp.end_time,'HH24:MI') as end_time,
               wp.is_free
        FROM week_plans wp JOIN employees e ON wp.employee_id=e.id
        WHERE wp.week_monday=$1
        ORDER BY e.name, wp.day_of_week
      `, [mondayStr]);
      return r.rows;
    }
    return rj(FILES.weekplans, []).filter(e => e.week_monday === mondayStr);
  },

  async saveWeekPlan(mondayStr, entries) {
    if (USE_PG) {
      for (const e of entries) {
        if (e.is_vacation) {
          await pool.query(`
            INSERT INTO week_plans (employee_id, week_monday, day_of_week, start_time, end_time, is_free, is_vacation)
            VALUES ($1,$2,$3,NULL,NULL,FALSE,TRUE)
            ON CONFLICT (employee_id, week_monday, day_of_week) DO UPDATE SET start_time=NULL, end_time=NULL, is_free=FALSE, is_vacation=TRUE
          `, [e.employee_id, mondayStr, e.day_of_week]);
        } else if (e.is_free) {
          await pool.query(`
            INSERT INTO week_plans (employee_id, week_monday, day_of_week, start_time, end_time, is_free, is_vacation)
            VALUES ($1,$2,$3,NULL,NULL,TRUE,FALSE)
            ON CONFLICT (employee_id, week_monday, day_of_week) DO UPDATE SET start_time=NULL, end_time=NULL, is_free=TRUE, is_vacation=FALSE
          `, [e.employee_id, mondayStr, e.day_of_week]);
        } else if (e.start_time && e.end_time) {
          await pool.query(`
            INSERT INTO week_plans (employee_id, week_monday, day_of_week, start_time, end_time, is_free, is_vacation)
            VALUES ($1,$2,$3,$4,$5,FALSE,FALSE)
            ON CONFLICT (employee_id, week_monday, day_of_week) DO UPDATE SET start_time=$4, end_time=$5, is_free=FALSE, is_vacation=FALSE
          `, [e.employee_id, mondayStr, e.day_of_week, e.start_time, e.end_time]);
        } else {
          await pool.query('DELETE FROM week_plans WHERE employee_id=$1 AND week_monday=$2 AND day_of_week=$3', [e.employee_id, mondayStr, e.day_of_week]);
        }
      }
      return;
    }
    const kept = rj(FILES.weekplans, []).filter(e => e.week_monday !== mondayStr);
    const newEntries = entries
      .filter(e => e.is_vacation || e.is_free || (e.start_time && e.end_time))
      .map(e => ({ ...e, week_monday: mondayStr }));
    wj(FILES.weekplans, [...kept, ...newEntries]);
  },

  async getWeekSchedule(mondayStr) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayStr + 'T12:00:00');
      d.setDate(d.getDate() + i);
      days.push(d.toLocaleDateString('sv-SE'));
    }

    if (USE_PG) {
      const emps = await pool.query('SELECT id, name FROM employees ORDER BY name');
      const plans = await pool.query(`
        SELECT employee_id, day_of_week,
               to_char(start_time,'HH24:MI') as start_time,
               to_char(end_time,'HH24:MI') as end_time,
               is_free
        FROM week_plans WHERE week_monday=$1`, [mondayStr]);
      const vacs = await pool.query(
        `SELECT employee_id, start_date, end_date FROM vacation_requests WHERE status='approved' AND start_date <= $1 AND end_date >= $2`,
        [days[6], days[0]]
      );
      return days.map((date, i) => ({
        date,
        employees: emps.rows.map(emp => {
          const onVac = vacs.rows.some(v => v.employee_id === emp.id && isoDate(v.start_date) <= date && isoDate(v.end_date) >= date);
          if (onVac) return { employee_id: emp.id, name: emp.name, is_vacation: true };
          const p = plans.rows.find(p => p.employee_id === emp.id && p.day_of_week === i);
          if (!p) return { employee_id: emp.id, name: emp.name, is_off: true };
          if (p.is_vacation) return { employee_id: emp.id, name: emp.name, is_vacation: true };
          if (p.is_free) return { employee_id: emp.id, name: emp.name, is_free: true };
          return { employee_id: emp.id, name: emp.name, start_time: p.start_time, end_time: p.end_time };
        })
      }));
    }

    const emps = rj(FILES.employees, []).sort((a, b) => a.name.localeCompare(b.name));
    const plans = rj(FILES.weekplans, []).filter(p => p.week_monday === mondayStr);
    const vacs  = rj(FILES.vacations, []).filter(v => v.status === 'approved');

    return days.map((date, i) => ({
      date,
      employees: emps.map(emp => {
        const onVac = vacs.some(v => v.employee_id === emp.id && v.start_date <= date && v.end_date >= date);
        if (onVac) return { employee_id: emp.id, name: emp.name, is_vacation: true };
        const p = plans.find(p => p.employee_id === emp.id && p.day_of_week === i);
        if (!p) return { employee_id: emp.id, name: emp.name, is_off: true };
        if (p.is_vacation) return { employee_id: emp.id, name: emp.name, is_vacation: true };
        if (p.is_free) return { employee_id: emp.id, name: emp.name, is_free: true };
        return { employee_id: emp.id, name: emp.name, start_time: p.start_time, end_time: p.end_time };
      })
    }));
  },

  async getVacations(employee_id = null) {
    if (USE_PG) {
      const q = employee_id
        ? `SELECT vr.*, e.name as employee_name, a.name as reviewer_name
           FROM vacation_requests vr JOIN employees e ON vr.employee_id=e.id
           LEFT JOIN admins a ON vr.reviewed_by=a.id
           WHERE vr.employee_id=$1 ORDER BY vr.created_at DESC`
        : `SELECT vr.*, e.name as employee_name, a.name as reviewer_name
           FROM vacation_requests vr JOIN employees e ON vr.employee_id=e.id
           LEFT JOIN admins a ON vr.reviewed_by=a.id
           ORDER BY vr.created_at DESC`;
      const r = await pool.query(q, employee_id ? [employee_id] : []);
      return r.rows.map(v => ({ ...v, start_date: isoDate(v.start_date), end_date: isoDate(v.end_date) }));
    }
    const vacations = rj(FILES.vacations, []);
    const emps   = rj(FILES.employees, []);
    const admins = rj(FILES.admins, []);
    return (employee_id ? vacations.filter(v => v.employee_id === employee_id) : vacations)
      .map(v => ({
        ...v,
        employee_name: emps.find(e => e.id === v.employee_id)?.name || '?',
        reviewer_name: v.reviewed_by ? admins.find(a => a.id === v.reviewed_by)?.name : null
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async submitVacation(employee_id, start_date, end_date, note) {
    if (USE_PG) {
      const r = await pool.query(
        'INSERT INTO vacation_requests (employee_id, start_date, end_date, note) VALUES ($1,$2,$3,$4) RETURNING id',
        [employee_id, start_date, end_date, note || null]
      );
      return r.rows[0];
    }
    const vacations = rj(FILES.vacations, []);
    const v = { id: nextId(vacations), employee_id, start_date, end_date, note: note || null, status: 'pending', reviewed_by: null, reviewed_at: null, admin_note: null, created_at: new Date().toISOString() };
    vacations.push(v); wj(FILES.vacations, vacations);
    return v;
  },

  async getAnnouncements() {
    if (USE_PG) {
      const r = await pool.query(`SELECT a.*, adm.name as admin_name FROM announcements a LEFT JOIN admins adm ON a.admin_id=adm.id ORDER BY a.created_at DESC`);
      return r.rows;
    }
    const admins = rj(FILES.admins, []);
    return rj(FILES.announcements, []).map(a => ({ ...a, admin_name: admins.find(x => x.id === a.admin_id)?.name || '?' })).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async createAnnouncement(admin_id, title, content, photo_data) {
    if (USE_PG) {
      const r = await pool.query('INSERT INTO announcements (admin_id,title,content,photo_data) VALUES ($1,$2,$3,$4) RETURNING id', [admin_id, title, content||null, photo_data||null]);
      return r.rows[0];
    }
    const list = rj(FILES.announcements, []);
    const a = { id: list.length === 0 ? 1 : Math.max(...list.map(x=>x.id))+1, admin_id, title, content: content||null, photo_data: photo_data||null, created_at: new Date().toISOString() };
    list.unshift(a); wj(FILES.announcements, list);
    return a;
  },

  async deleteAnnouncement(id) {
    if (USE_PG) { await pool.query('DELETE FROM announcements WHERE id=$1', [id]); return; }
    wj(FILES.announcements, rj(FILES.announcements, []).filter(a => a.id !== id));
  },

  async getUnreadCount(employee_id) {
    if (USE_PG) {
      const seen = await pool.query('SELECT last_seen_at FROM employee_seen WHERE employee_id=$1', [employee_id]);
      const lastSeen = seen.rows[0]?.last_seen_at || '2000-01-01';
      const r = await pool.query('SELECT COUNT(*) FROM announcements WHERE created_at > $1', [lastSeen]);
      return parseInt(r.rows[0].count);
    }
    const seen = rj(FILES.seen, {});
    const lastSeen = seen[employee_id] || '2000-01-01';
    return rj(FILES.announcements, []).filter(a => a.created_at > lastSeen).length;
  },

  async markSeen(employee_id) {
    if (USE_PG) {
      await pool.query('INSERT INTO employee_seen (employee_id, last_seen_at) VALUES ($1,NOW()) ON CONFLICT (employee_id) DO UPDATE SET last_seen_at=NOW()', [employee_id]);
      return;
    }
    const seen = rj(FILES.seen, {});
    seen[employee_id] = new Date().toISOString();
    wj(FILES.seen, seen);
  },

  async reviewVacation(id, status, admin_id, admin_note) {
    if (USE_PG) {
      await pool.query(
        'UPDATE vacation_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW(), admin_note=$4 WHERE id=$3',
        [status, admin_id, id, admin_note || null]
      );
      return;
    }
    const vacations = rj(FILES.vacations, []);
    const i = vacations.findIndex(v => v.id === id);
    if (i >= 0) {
      vacations[i] = { ...vacations[i], status, reviewed_by: admin_id, reviewed_at: new Date().toISOString(), admin_note: admin_note || null };
      wj(FILES.vacations, vacations);
    }
  }
};

module.exports = db;
