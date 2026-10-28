"""Shared local-demo infrastructure. Copied into each independent scan snapshot."""
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

SESSION_SECONDS = 7200
MAX_BODY = 32768


class APIError(Exception):
    def __init__(self, status, message, field=None):
        self.status, self.message, self.field = status, message, field


def connect(path):
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return salt + ':' + value


def password_matches(password, stored):
    salt = stored.split(':', 1)[0]
    return hmac.compare_digest(password_hash(password, salt), stored)


def text(data, key, minimum=1, maximum=120):
    value = data.get(key)
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise APIError(400, '请填写%s（%s–%s个字符）。' % (key, minimum, maximum), key)
    return value.strip()


def email(data, key='email'):
    value = text(data, key, 3, 254).lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
        raise APIError(400, '请填写有效的邮箱地址。', key)
    return value


def new_id(prefix):
    return prefix + secrets.token_hex(5).upper()


class DemoHandler(BaseHTTPRequestHandler):
    server_version = 'MakersLocal/1.0'

    def log_message(self, fmt, *args):
        # Do not log credentials, query strings or request bodies.
        pass

    def db(self):
        return connect(self.server.db_path)

    def headers_common(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.send_header('Cache-Control', 'no-store')

    def respond(self, payload, status=200, content_type='application/json; charset=utf-8'):
        body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.headers_common()
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        if getattr(self, 'new_cookie', None):
            self.send_header('Set-Cookie', self.new_cookie)
        self.end_headers()
        self.wfile.write(body)

    def validate_host(self):
        port = self.server.server_address[1]
        if self.headers.get('Host') not in ('127.0.0.1:%d' % port, 'localhost:%d' % port):
            raise APIError(403, '仅允许本机访问。')

    def get_session(self):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
        except cookies.CookieError:
            pass
        item = jar.get(self.server.cookie_name)
        token = item.value if item else ''
        session = None
        if 20 <= len(token) <= 100:
            digest = hashlib.sha256(token.encode()).hexdigest()
            with self.db() as db:
                row = db.execute('SELECT * FROM sessions WHERE token_hash=? AND expires>?', (digest, int(time.time()))).fetchone()
                session = dict(row) if row else None
        if session is None:
            session = self.create_session(None)
        self.session = session
        return session

    def create_session(self, user_id):
        token = secrets.token_urlsafe(32)
        session = {'token_hash': hashlib.sha256(token.encode()).hexdigest(), 'user_id': user_id,
                   'csrf': secrets.token_urlsafe(32), 'expires': int(time.time()) + SESSION_SECONDS}
        with self.db() as db:
            db.execute('DELETE FROM sessions WHERE expires<=?', (int(time.time()),))
            db.execute('INSERT INTO sessions(token_hash,user_id,csrf,expires) VALUES(?,?,?,?)', tuple(session.values()))
        self.new_cookie = '%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d' % (self.server.cookie_name, token, SESSION_SECONDS)
        self.session = session
        return session

    def rotate_session(self, user_id):
        with self.db() as db:
            db.execute('DELETE FROM sessions WHERE token_hash=?', (self.session['token_hash'],))
        return self.create_session(user_id)

    def read_json(self):
        expected = 'http://' + self.headers.get('Host', '')
        if self.headers.get('Origin') != expected:
            raise APIError(403, '请求来源不匹配，请从当前网站重新操作。')
        if not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), self.session['csrf']):
            raise APIError(403, '页面状态已更新，请刷新后重试。')
        if self.headers.get_content_type() != 'application/json':
            raise APIError(415, '请使用JSON提交。')
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise APIError(400, '无效的请求长度。')
        if not 0 < length <= MAX_BODY:
            raise APIError(413, '提交内容过长或为空。')
        try:
            data = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeError):
            raise APIError(400, '提交内容无法读取。')
        if not isinstance(data, dict):
            raise APIError(400, '提交内容必须是一个对象。')
        return data

    def serve_static(self, path):
        allowed = {'/': ('index.html', 'text/html; charset=utf-8'),
                   '/index.html': ('index.html', 'text/html; charset=utf-8'),
                   '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                   '/ui.js': ('ui.js', 'text/javascript; charset=utf-8'),
                   '/style.css': ('style.css', 'text/css; charset=utf-8'),
                   '/tokens.css': ('tokens.css', 'text/css; charset=utf-8'),
                   '/poster.svg': ('poster.svg', 'image/svg+xml'),
                   '/fonts/NotoSansSC.woff2': ('fonts/NotoSansSC.woff2', 'font/woff2')}
        if path not in allowed:
            raise APIError(404, '没有找到这个页面。')
        filename, mime = allowed[path]
        file = self.server.static_path / filename
        if not file.is_file():
            raise APIError(404, '没有找到这个文件。')
        self.respond(file.read_bytes(), content_type=mime)

    def dispatch(self, method):
        self.new_cookie = None
        try:
            self.validate_host()
            self.route_path = urlsplit(self.path).path
            self.query = urlsplit(self.path).query
            if method == 'GET' and not self.route_path.startswith('/api/'):
                self.serve_static(self.route_path)
                return
            self.get_session()
            self.handle_api(method)
        except APIError as exc:
            self.respond({'error': exc.message, 'field': exc.field}, exc.status)
        except sqlite3.IntegrityError:
            self.respond({'error': '这条信息已存在，请检查后重试。'}, 409)
        except Exception:
            self.respond({'error': '暂时无法完成操作，请稍后重试。'}, 500)

    def do_GET(self):
        self.dispatch('GET')

    def do_POST(self):
        self.dispatch('POST')

    def do_PUT(self):
        self.dispatch('PUT')


def launch(handler, root, data_dir, port, cookie_name, stage):
    server = ThreadingHTTPServer(('127.0.0.1', port), handler)
    server.daemon_threads = True
    server.db_path = Path(data_dir) / 'demo.sqlite3'
    server.static_path = Path(root) / 'static'
    server.cookie_name = cookie_name
    server.stage = stage
    print(json.dumps({'stage': stage, 'url': 'http://127.0.0.1:%d' % server.server_address[1]}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
