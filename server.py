"""Stage 2: accounts, owner-scoped registrations and an admin workspace."""
import argparse
import datetime
import json
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs
from common import APIError, DemoHandler, connect, email, launch, new_id, password_hash, password_matches, text

ROOT = Path(__file__).resolve().parent
ATTEMPTS = {}
ATTEMPT_LOCK = threading.Lock()
DUMMY_HASH = password_hash(secrets.token_urlsafe(24))


def now():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds')


def seed(data_dir):
    data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with connect(data_dir / 'demo.sqlite3') as db:
        db.executescript((ROOT / 'schema.sql').read_text())
        if not db.execute('SELECT count(*) FROM users').fetchone()[0]:
            accounts = []
            for uid, name, address, role in [('usr-a', '演示用户 A', 'a@example.test', 'user'), ('usr-b', '演示用户 B', 'b@example.test', 'user'), ('usr-admin', '活动管理员', 'admin@example.test', 'admin')]:
                password = secrets.token_urlsafe(14)
                db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (uid, name, address, password_hash(password), role, now()))
                accounts.append({'id': uid, 'name': name, 'email': address, 'password': password, 'role': role})
            account_file = data_dir / 'accounts.json'
            account_file.write_text(json.dumps(accounts, ensure_ascii=False, indent=2))
            account_file.chmod(0o600)
            (data_dir / '演示账号.txt').write_text('本机拍摄模拟账号；密码每次新建数据时随机产生。请勿用于公开部署。\n\n' + '\n\n'.join('身份：%(name)s\n邮箱：%(email)s\n密码：%(password)s' % account for account in accounts))
            (data_dir / '演示账号.txt').chmod(0o600)
        if not db.execute('SELECT count(*) FROM events').fetchone()[0]:
            for event in json.loads((ROOT / 'seed.json').read_text())['events']:
                db.execute('INSERT INTO events(id,title,subtitle,category,starts_at,location,capacity,description) VALUES(:id,:title,:subtitle,:category,:starts_at,:location,:capacity,:description)', event)
            for rid, event_id, uid in [('BM-DEMO101', 'evt-build', 'usr-a'), ('BM-DEMO102', 'evt-design', 'usr-a'), ('BM-DEMO201', 'evt-build', 'usr-b')]:
                user = db.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
                db.execute('INSERT INTO registrations VALUES(?,?,?,?,?,?)', (rid, event_id, uid, user['display_name'], user['email'], '2026-10-28T10:00:00+08:00'))


class Handler(DemoHandler):
    def current_user(self, required=False, admin=False):
        with self.db() as db:
            row = db.execute('SELECT id,display_name,email,role FROM users WHERE id=?', (self.session['user_id'],)).fetchone()
        user = dict(row) if row else None
        if (required or admin) and not user:
            raise APIError(401, '请先登录账号。')
        if admin and user['role'] != 'admin':
            raise APIError(403, '当前账号没有管理员权限。')
        return user

    def registration_list(self, admin=False):
        user = self.current_user(required=True, admin=admin)
        query = parse_qs(self.query)
        try:
            page = max(1, int(query.get('page', ['1'])[0]))
        except ValueError:
            raise APIError(400, '页码格式不正确。')
        where, params = ('', []) if admin else (' WHERE r.user_id=?', [user['id']])
        with self.db() as db:
            total = db.execute('SELECT count(*) FROM registrations r' + where, params).fetchone()[0]
            rows = db.execute('SELECT r.*,e.title,e.starts_at,e.location FROM registrations r JOIN events e ON e.id=r.event_id' + where + ' ORDER BY r.created_at DESC,r.id LIMIT 20 OFFSET ?', params + [(page - 1) * 20]).fetchall()
        return self.respond({'registrations': [dict(row) for row in rows], 'page': page, 'total': total, 'page_size': 20})

    def event_input(self, data):
        result = {key: text(data, key, 1, length) for key, length in [('title', 70), ('subtitle', 100), ('category', 20), ('location', 100), ('description', 1600), ('starts_at', 16)]}
        try:
            stamp = datetime.datetime.strptime(result['starts_at'], '%Y-%m-%dT%H:%M')
            if stamp.strftime('%Y-%m-%dT%H:%M') != result['starts_at']:
                raise ValueError()
        except ValueError:
            raise APIError(400, '时间格式请使用2026-11-07T14:00。', 'starts_at')
        capacity = data.get('capacity')
        if isinstance(capacity, bool) or not isinstance(capacity, int) or not 1 <= capacity <= 1000:
            raise APIError(400, '活动名额应为1–1000之间的整数。', 'capacity')
        result['capacity'] = capacity
        return result

    def handle_api(self, method):
        path = self.route_path
        if method == 'GET' and path == '/api/health':
            return self.respond({'app': 'makers-local', 'stage': 'members'})
        if method == 'GET' and path == '/api/session':
            return self.respond({'stage': 'members', 'user': self.current_user(), 'csrf': self.session['csrf']})
        if method == 'GET' and path == '/api/events':
            with self.db() as db:
                rows = db.execute('SELECT e.*,(SELECT count(*) FROM registrations r WHERE r.event_id=e.id) AS registered FROM events e ORDER BY starts_at,id').fetchall()
            return self.respond({'events': [dict(row) for row in rows]})
        if method == 'POST' and path in ('/api/auth/login', '/api/auth/register'):
            data = self.read_json()
            address = email(data)
            password = data.get('password')
            if not isinstance(password, str) or not 10 <= len(password) <= 128:
                raise APIError(400, '密码需要10–128个字符。', 'password')
            if path.endswith('/register'):
                name = text(data, 'display_name', 1, 40)
                uid = new_id('usr-')
                with self.db() as db:
                    if db.execute('SELECT 1 FROM users WHERE email=?', (address,)).fetchone():
                        raise APIError(409, '这个邮箱已注册，请直接登录。', 'email')
                    db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)', (uid, name, address, password_hash(password), 'user', now()))
            else:
                key = self.client_address[0] + '|' + address
                with ATTEMPT_LOCK:
                    for old_key in list(ATTEMPTS):
                        if ATTEMPTS[old_key][0] < time.time() - 600:
                            del ATTEMPTS[old_key]
                    since, count = ATTEMPTS.get(key, (time.time(), 0))
                    if count >= 12:
                        raise APIError(429, '尝试次数过多，请10分钟后重试。')
                    ATTEMPTS[key] = (since, count + 1)
                with self.db() as db:
                    user = db.execute('SELECT * FROM users WHERE email=?', (address,)).fetchone()
                valid = password_matches(password, user['password_hash'] if user else DUMMY_HASH)
                if not user or not valid:
                    raise APIError(401, '邮箱或密码不正确，请检查后重试。', 'password')
                uid = user['id']
                with ATTEMPT_LOCK:
                    ATTEMPTS.pop(key, None)
            self.rotate_session(uid)
            return self.respond({'user': self.current_user(), 'csrf': self.session['csrf']}, 201 if path.endswith('/register') else 200)
        if method == 'POST' and path == '/api/auth/logout':
            self.read_json()
            self.rotate_session(None)
            return self.respond({'user': None, 'csrf': self.session['csrf']})
        if method == 'POST' and path == '/api/registrations':
            user = self.current_user(required=True)
            data = self.read_json()
            event_id = text(data, 'event_id', 1, 50)
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                event = db.execute('SELECT * FROM events WHERE id=?', (event_id,)).fetchone()
                if not event:
                    raise APIError(404, '活动不存在。')
                if db.execute('SELECT 1 FROM registrations WHERE event_id=? AND user_id=?', (event_id, user['id'])).fetchone():
                    raise APIError(409, '你已经报名了这场活动，可在我的报名中查看。')
                count = db.execute('SELECT count(*) FROM registrations WHERE event_id=?', (event_id,)).fetchone()[0]
                if count >= event['capacity']:
                    raise APIError(409, '本场名额已满，请选择其他活动。')
                registration = {'id': new_id('BM-'), 'event_id': event_id, 'user_id': user['id'], 'display_name': user['display_name'], 'email': user['email'], 'created_at': now()}
                db.execute('INSERT INTO registrations(id,event_id,user_id,display_name,email,created_at) VALUES(:id,:event_id,:user_id,:display_name,:email,:created_at)', registration)
            return self.respond({'registration': registration}, 201)
        if method == 'GET' and path == '/api/registrations':
            return self.registration_list()
        if method == 'GET' and path.startswith('/api/registrations/'):
            user = self.current_user(required=True)
            rid = path.removeprefix('/api/registrations/')
            with self.db() as db:
                row = db.execute('SELECT r.*,e.title,e.starts_at,e.location FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.id=? AND (r.user_id=? OR ?=?)', (rid, user['id'], user['role'], 'admin')).fetchone()
            if not row:
                raise APIError(404, '没有找到这条报名记录。')
            return self.respond({'registration': dict(row)})
        if method == 'GET' and path == '/api/admin/registrations':
            return self.registration_list(admin=True)
        if method == 'GET' and path == '/api/admin/stats':
            self.current_user(admin=True)
            with self.db() as db:
                counts = {key: db.execute('SELECT count(*) FROM ' + table).fetchone()[0] for key, table in [('events', 'events'), ('registrations', 'registrations'), ('users', 'users')]}
            return self.respond(counts)
        if method == 'POST' and path == '/api/admin/events':
            self.current_user(admin=True)
            event = self.event_input(self.read_json())
            event['id'] = new_id('evt-')
            with self.db() as db:
                db.execute('INSERT INTO events(id,title,subtitle,category,starts_at,location,capacity,description) VALUES(:id,:title,:subtitle,:category,:starts_at,:location,:capacity,:description)', event)
            return self.respond({'id': event['id']}, 201)
        if method == 'PUT' and path.startswith('/api/admin/events/'):
            self.current_user(admin=True)
            data = self.read_json()
            event = self.event_input(data)
            event['id'] = path.removeprefix('/api/admin/events/')
            version = data.get('version')
            if isinstance(version, bool) or not isinstance(version, int) or version < 1:
                raise APIError(400, '活动版本号无效，请刷新后重试。')
            event['version'] = version
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                existing = db.execute('SELECT * FROM events WHERE id=?', (event['id'],)).fetchone()
                if not existing:
                    raise APIError(404, '活动不存在。')
                count = db.execute('SELECT count(*) FROM registrations WHERE event_id=?', (event['id'],)).fetchone()[0]
                if event['capacity'] < count:
                    raise APIError(409, '名额不能少于当前已报名人数。', 'capacity')
                changed = db.execute('UPDATE events SET title=:title,subtitle=:subtitle,category=:category,starts_at=:starts_at,location=:location,capacity=:capacity,description=:description,version=version+1 WHERE id=:id AND version=:version', event).rowcount
                if not changed:
                    raise APIError(409, '活动已在其他页面更新，请重新打开后编辑。')
            return self.respond({'id': event['id'], 'version': version + 1})
        raise APIError(404, '没有找到这个接口。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8762)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'local_data')
    parser.add_argument('--seed-only', action='store_true')
    args = parser.parse_args()
    seed(args.data_dir)
    if not args.seed_only:
        launch(Handler, ROOT, args.data_dir, args.port, 'makers_members', 'members')
