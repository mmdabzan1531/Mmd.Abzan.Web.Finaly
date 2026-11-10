import os, sys
ASYNC_MODE = "threading"
if os.environ.get("CHATROOM_ASYNC", "").strip() == "gevent" or "gevent" in sys.modules:
    try:                                   # must run before any other import
        from gevent import monkey
        monkey.patch_all()
        ASYNC_MODE = "gevent"
    except ImportError:
        print("[async] CHATROOM_ASYNC=gevent but gevent is not installed -> threading mode")
import base64, json, re, uuid, secrets, threading, random, sqlite3, hashlib, hmac, smtplib, ssl, copy, mimetypes
import urllib.request, urllib.parse, urllib.error
from email.message import EmailMessage
from collections import defaultdict, deque
from contextlib import closing
from datetime import datetime, timezone
from functools import wraps
import time
import socket as pysocket
from flask import (Flask, render_template, request, redirect, url_for, session,
                   flash, jsonify, send_from_directory, make_response)
from flask_socketio import SocketIO, emit, join_room
from flask import abort, Response
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_dotenv():
    """Tiny .env reader (no extra dependency): KEY=value lines, existing environment variables win."""
    try:
        with open(os.path.join(BASE_DIR, ".env"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip()
                if len(v) > 1 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                os.environ.setdefault(k.strip(), v)
    except FileNotFoundError:
        pass


_load_dotenv()
DATA_DIR = os.environ.get("CHATROOM_DATA_DIR", os.path.join(BASE_DIR, "data"))
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
USERS_FILE = os.path.join(DATA_DIR, "users.json")
GROUPS_FILE = os.path.join(DATA_DIR, "groups.json")
DB_FILE = os.path.join(DATA_DIR, "chat.db")
SUPPORT_FILE = os.path.join(DATA_DIR, "support.json")
# Set DATABASE_URL (Neon / Supabase / any Postgres) to keep users, groups, messages and avatars across restarts.
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_PG = bool(DATABASE_URL)
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_IMAGE_SIZE = 4 * 1024 * 1024                      # profile photos
try:
    MAX_FILE_MB = max(1, int(os.environ.get("CHATROOM_MAX_FILE_MB", "15")))
except ValueError:
    MAX_FILE_MB = 15
MAX_FILE_SIZE = MAX_FILE_MB * 1024 * 1024             # chat attachments (images / files)
PAGE = 60

# ---------- attachments ----------
IMAGE_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
AUDIO_MIME = {".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav",
              ".m4a": "audio/mp4", ".aac": "audio/aac"}
VIDEO_MIME = {".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"}
INLINE_MIME = {**IMAGE_MIME, **AUDIO_MIME, **VIDEO_MIME}      # shown in the browser; everything else is a download
BLOCKED_EXT = {".html", ".htm", ".xhtml", ".svg", ".js", ".mjs", ".php", ".exe", ".bat", ".cmd", ".scr", ".msi",
               ".vbs", ".ps1", ".jar", ".dll"}


def load_secret():
    """Keep sessions valid across restarts even when CHATROOM_SECRET is not set."""
    env = os.environ.get("CHATROOM_SECRET")
    if env:
        return env
    path = os.path.join(DATA_DIR, ".secret")
    try:
        with open(path) as f:
            return f.read().strip()
    except FileNotFoundError:
        value = secrets.token_hex(32)
        with open(path, "w") as f:
            f.write(value)
        return value


app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.config.update(
    SECRET_KEY=load_secret(),
    MAX_CONTENT_LENGTH=MAX_FILE_SIZE + 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("RENDER_EXTERNAL_HOSTNAME")) or os.environ.get("CHATROOM_HTTPS") == "1",
    PERMANENT_SESSION_LIFETIME=60 * 24 * 3600,  # stay signed in for 60 days
)
app.jinja_env.globals["ASSET_V"] = str(int(time.time()))


@app.after_request
def security_headers(resp):
    """Baseline hardening for every response (pages, API and media)."""
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "SAMEORIGIN")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()")
    h.setdefault("Content-Security-Policy", "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'")
    if request.is_secure:
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return resp


@app.errorhandler(413)
def too_large(_e):
    return jsonify(error=f"حجم فایل بیشتر از {MAX_FILE_MB} مگابایت است."), 413


# Realtime: Socket.IO behind a proxy (Render, nginx, ...) sees a different Origin/Host
# than the browser, so a strict origin check rejects the handshake and the chat stays
# on "connecting" forever. Sessions use SameSite=Lax cookies, so a cross-site page can't
# ride on a visitor's login anyway. Set CHATROOM_CORS="https://my.site" to restrict.
_cors = os.environ.get("CHATROOM_CORS", "*").strip()
socketio = SocketIO(
    app, async_mode=ASYNC_MODE, ping_interval=20, ping_timeout=30,
    cors_allowed_origins="*" if _cors in ("", "*") else [x.strip() for x in _cors.split(",") if x.strip()],
    max_http_buffer_size=64 * 1024,
)

data_lock = threading.RLock()
online_sids = {}
recent_sends = defaultdict(deque)


# ---------- storage: Postgres when DATABASE_URL is set, otherwise local files + SQLite ----------
_pool = None
_kv_cache = {}          # key -> value (single process: write-through, so it is always current)

if USE_PG:
    try:
        import psycopg2, psycopg2.pool, psycopg2.extras
        if ASYNC_MODE == "gevent":
            from psycogreen.gevent import patch_psycopg
            patch_psycopg()
    except ImportError:
        raise SystemExit("DATABASE_URL is set but psycopg2 is not installed: add 'psycopg2-binary' to requirements.txt")


def _pg_pool():
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            1, 8, DATABASE_URL, connect_timeout=15, keepalives=1, keepalives_idle=30,
            keepalives_interval=10, keepalives_count=3)
    return _pool


def pg_run(sql, args=(), fetch=True):
    """Run one statement on a pooled connection; reconnect once if the server dropped an idle connection."""
    last = None
    for _ in range(2):
        pool = _pg_pool()
        conn = pool.getconn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, args)
                rows = cur.fetchall() if (fetch and cur.description) else []
            conn.commit()
            pool.putconn(conn)
            return rows
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
            last = e
            pool.putconn(conn, close=True)
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            pool.putconn(conn)
            raise
    raise last


def _kv_key(path):
    return os.path.basename(path)


# ---------- JSON store (users, groups, support) ----------
def write_json(path, value):
    with data_lock:
        if USE_PG:
            k = _kv_key(path)
            pg_run("INSERT INTO kv(key, value) VALUES(%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                   (k, psycopg2.extras.Json(value)), fetch=False)
            _kv_cache[k] = copy.deepcopy(value)
            return
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)


def read_json(path, default):
    with data_lock:
        if USE_PG:
            k = _kv_key(path)
            if k in _kv_cache:
                return copy.deepcopy(_kv_cache[k])
            rows = pg_run("SELECT value FROM kv WHERE key = %s", (k,))
            if rows:
                _kv_cache[k] = rows[0]["value"]
                return copy.deepcopy(rows[0]["value"])
            write_json(path, default)
            return copy.deepcopy(default)
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            write_json(path, default)
            return default


# ---------- message store (permanent history) ----------
def db():
    c = sqlite3.connect(DB_FILE, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def q(sql, args=(), one=False, commit=False):
    if USE_PG:
        rows = pg_run(sql.replace("?", "%s"), tuple(args))
        return (rows[0] if rows else None) if one else rows
    with closing(db()) as c:
        rows = c.execute(sql, args).fetchall()
        if commit:
            c.commit()
        return (rows[0] if rows else None) if one else rows


SELECT_MSG = ("SELECT m.*, p.text AS reply_text, p.username AS reply_user "
              "FROM messages m LEFT JOIN messages p ON p.id = m.reply_to ")


def init_db():
    if USE_PG:
        for stmt in (
            "CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value JSONB NOT NULL)",
            "CREATE TABLE IF NOT EXISTS media(name TEXT PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL)",
            "CREATE TABLE IF NOT EXISTS messages(seq BIGSERIAL PRIMARY KEY, id TEXT UNIQUE NOT NULL, "
            "group_id TEXT NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, "
            "reply_to TEXT DEFAULT '', edited INTEGER DEFAULT 0, forwarded_from TEXT DEFAULT '', attach TEXT DEFAULT '')",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS attach TEXT DEFAULT ''",     # upgrade for existing databases
            "CREATE TABLE IF NOT EXISTS reactions(message_id TEXT NOT NULL, username TEXT NOT NULL, "
            "emoji TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(message_id, username))",
            "CREATE TABLE IF NOT EXISTS poll_votes(message_id TEXT NOT NULL, username TEXT NOT NULL, "
            "opt INTEGER NOT NULL, PRIMARY KEY(message_id, username))",
            "CREATE INDEX IF NOT EXISTS idx_group_seq ON messages(group_id, seq)"):
            pg_run(stmt, fetch=False)
        return
    with closing(db()) as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("""CREATE TABLE IF NOT EXISTS messages(
            seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
            group_id TEXT NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL,
            created_at TEXT NOT NULL, reply_to TEXT DEFAULT '',
            edited INTEGER DEFAULT 0, forwarded_from TEXT DEFAULT '', attach TEXT DEFAULT '')""")
        if "attach" not in [r[1] for r in c.execute("PRAGMA table_info(messages)")]:
            c.execute("ALTER TABLE messages ADD COLUMN attach TEXT DEFAULT ''")      # upgrade for existing databases
        c.execute("CREATE INDEX IF NOT EXISTS idx_group_seq ON messages(group_id, seq)")
        c.execute("CREATE TABLE IF NOT EXISTS reactions(message_id TEXT NOT NULL, username TEXT NOT NULL, "
                  "emoji TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(message_id, username))")
        c.execute("CREATE TABLE IF NOT EXISTS poll_votes(message_id TEXT NOT NULL, username TEXT NOT NULL, "
                  "opt INTEGER NOT NULL, PRIMARY KEY(message_id, username))")
        c.commit()
    old = os.path.join(DATA_DIR, "messages.json")  # one-time import of old history
    if os.path.exists(old) and q("SELECT COUNT(*) c FROM messages", one=True)["c"] == 0:
        try:
            with open(old, encoding="utf-8") as f:
                items = json.load(f)
            with closing(db()) as c:
                for m in items:
                    c.execute("INSERT OR IGNORE INTO messages(id,group_id,username,text,created_at,reply_to,edited,forwarded_from) VALUES(?,?,?,?,?,?,?,?)",
                              (m.get("id") or uuid.uuid4().hex, m.get("group_id", "general"), m.get("username", ""),
                               m.get("text", ""), m.get("created_at") or datetime.now(timezone.utc).isoformat(),
                               m.get("reply_to", ""), int(bool(m.get("edited"))), m.get("forwarded_from", "")))
                c.commit()
            os.replace(old, old + ".migrated")
        except Exception as e:  # never block startup
            print("message migration skipped:", e)


def init_data():
    init_db()
    read_json(USERS_FILE, {})      # creates it only when missing (never overwrites)
    groups = read_json(GROUPS_FILE, {})
    groups.pop("general", None)  # no public chat anymore
    for gid, g in groups.items():
        g.setdefault("members", [])
        g.setdefault("owner", "")
        g.setdefault("type", "group")
        g.setdefault("invite_code", secrets.token_urlsafe(12))
        g.setdefault("admins", [])
        g.setdefault("banned", [])
        g.setdefault("avatar_url", "")
        g.setdefault("background", "")
        g.setdefault("pins", [])
        g.setdefault("only_admins_post", False)
        g.setdefault("members_can_invite", True)
        if g["type"] != "dm" and g["owner"] in ("", "system") and g["members"]:
            g["owner"] = g["members"][0]          # old groups without an owner: the first member becomes owner
    write_json(GROUPS_FILE, groups)


init_data()
if USE_PG and not os.environ.get("CHATROOM_SECRET"):
    _sec = read_json(os.path.join(DATA_DIR, "secret.json"), {})
    if not _sec.get("v"):
        _sec = {"v": secrets.token_hex(32)}
        write_json(os.path.join(DATA_DIR, "secret.json"), _sec)
    app.config["SECRET_KEY"] = _sec["v"]


# ---------- attachment helpers ----------
def _raw_attach(r):
    try:
        return r["attach"] or ""
    except (KeyError, IndexError):
        return ""


def _parse_attach(s):
    if not s:
        return None
    try:
        d = json.loads(s)
        return d if isinstance(d, dict) else None
    except (ValueError, TypeError):
        return None


# ---------- special messages: location / contact / poll (sent as text with a marker) ----------
SPECIAL_RE = re.compile(r"^\u27e6(loc|contact|poll)\u27e7(.*)$", re.S)


def parse_special(text):
    """-> (kind, clean_dict) or None when the text is not a valid special message."""
    m = SPECIAL_RE.match(text or "")
    if not m:
        return None
    try:
        d = json.loads(m.group(2))
    except ValueError:
        return None
    if not isinstance(d, dict):
        return None
    k = m.group(1)
    try:
        if k == "loc":
            lat, lon = float(d["lat"]), float(d["lon"])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                return None
            return k, {"lat": round(lat, 6), "lon": round(lon, 6)}
        if k == "contact":
            name, phone = str(d.get("name", "")).strip()[:60], str(d.get("phone", "")).strip()[:30]
            if not name or not re.fullmatch(r"[+\d\s()\-]{3,30}", phone):
                return None
            return k, {"name": name, "phone": phone}
        if k == "poll":
            qn = str(d.get("q", "")).strip()[:120]
            opts = [str(o).strip()[:50] for o in (d.get("o") or []) if str(o).strip()][:6]
            if not qn or len(opts) < 2:
                return None
            return k, {"q": qn, "o": opts}
    except (KeyError, TypeError, ValueError):
        return None
    return None


def normalize_special(text):
    """Rebuilds a special message from validated data. -> (text, error)"""
    if not SPECIAL_RE.match(text or ""):
        return text, ""
    p = parse_special(text)
    if not p:
        return None, "پیام ویژه نامعتبر است."
    return "\u27e6" + p[0] + "\u27e7" + json.dumps(p[1], ensure_ascii=False, separators=(",", ":")), ""


def special_label(text):
    p = parse_special(text) if text and text[:1] == "\u27e6" else None
    if not p:
        return ""
    k, d = p
    return {"loc": "📍 موقعیت مکانی", "contact": "👤 مخاطب: " + d.get("name", "") if k == "contact" else "",
            "poll": "📊 " + d.get("q", "") if k == "poll" else ""}[k][:60]


def _preview(text, attach_raw):
    """Text shown in the chat list: the message, or a label for photos / files."""
    if text:
        return special_label(text) or text[:60]
    a = _parse_attach(attach_raw)
    if a:
        return {"image": "📷 عکس", "video": "🎞 ویدیو", "audio": "🎵 صوت"}.get(a.get("kind"), "📎 " + str(a.get("name", "فایل")))[:60]
    return ""


def clean_filename(raw):
    """Keeps Persian / unicode names (werkzeug's secure_filename would strip them)."""
    name = os.path.basename(str(raw or "").replace("\\", "/"))
    name = re.sub(r'[\x00-\x1f<>:"|?*]', "", name).strip().strip(".")
    return name[:100] or "file"


def file_ext(name):
    ext = os.path.splitext(name)[1].lower()
    return ext if re.fullmatch(r"\.[a-z0-9]{1,8}", ext) else ""


def looks_like_image(head):
    return (head[:8] == b"\x89PNG\r\n\x1a\n" or head[:3] == b"\xff\xd8\xff" or head[:6] in (b"GIF87a", b"GIF89a")
            or (head[:4] == b"RIFF" and head[8:12] == b"WEBP"))


def _disposition(inline, name):
    ascii_name = re.sub(r"[^A-Za-z0-9._-]", "_", name) or "file"
    return f"{'inline' if inline else 'attachment'}; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(name)}"


def store_media(stored_name, mime, data):
    if USE_PG:
        q("INSERT INTO media(name, mime, data) VALUES(?,?,?)", (stored_name, mime, psycopg2.Binary(data)), commit=True)
    else:
        with open(os.path.join(UPLOAD_DIR, stored_name), "wb") as f:
            f.write(data)


def cleanup_media(stored_names):
    """Delete stored files that no message references any more (forwarded copies share one file)."""
    for nm in set(n for n in stored_names if n):
        try:
            if q("SELECT 1 FROM messages WHERE attach LIKE ? LIMIT 1", ("%" + nm + "%",), one=True):
                continue
            if USE_PG:
                q("DELETE FROM media WHERE name=?", (nm,), commit=True)
            else:
                path = os.path.join(UPLOAD_DIR, os.path.basename(nm))
                if os.path.exists(path):
                    os.remove(path)
        except Exception as e:
            print("[media] cleanup failed:", repr(e))


def remove_media_url(url):
    """Delete the stored file behind a '/media/<name>' URL (old profile / group photo). Other URLs are ignored."""
    url = str(url or "")
    if not url.startswith("/media/"):
        return
    nm = url.rsplit("/", 1)[-1].split("?")[0]
    if not nm:
        return
    try:
        if USE_PG:
            q("DELETE FROM media WHERE name=?", (nm,), commit=True)
        else:
            path = os.path.join(UPLOAD_DIR, os.path.basename(nm))
            if os.path.exists(path):
                os.remove(path)
    except Exception as e:
        print("[media] remove failed:", repr(e))


def shape(r, users):
    u = users.get(r["username"], {})
    ru = users.get(r["reply_user"] or "", {})
    rt = r["reply_text"]
    return {
        "id": r["id"], "seq": r["seq"], "group_id": r["group_id"], "username": r["username"],
        "display_name": u.get("display_name", r["username"]), "avatar": u.get("avatar", "🙂"),
        "avatar_url": u.get("avatar_url", ""), "text": r["text"], "created_at": r["created_at"],
        "edited": bool(r["edited"]), "forwarded_from": r["forwarded_from"] or "",
        "attach": _parse_attach(_raw_attach(r)),
        "reply_to": r["reply_to"] or "",
        "reply_text": ("📎 پیوست" if rt == "" else (special_label(rt or "") or rt or ""))[:120],
        "reply_name": ru.get("display_name", r["reply_user"] or ""),
        "reply_gone": bool(r["reply_to"]) and rt is None,
        "reactions": [],
    }


def fetch_page(gid, before=None, limit=PAGE):
    sql = SELECT_MSG + "WHERE m.group_id=? " + ("AND m.seq<? " if before else "") + "ORDER BY m.seq DESC LIMIT ?"
    rows = q(sql, (gid, before, limit + 1) if before else (gid, limit + 1))
    more = len(rows) > limit
    users = read_json(USERS_FILE, {})
    out = [shape(r, users) for r in reversed(rows[:limit])]
    attach_reactions(out)
    return out, more


def fetch_one(mid):
    r = q(SELECT_MSG + "WHERE m.id=?", (mid,), one=True)
    return (r, shape(r, read_json(USERS_FILE, {}))) if r else (None, None)


def insert_message(gid, username, text, reply_to="", forwarded_from="", attach=""):
    mid, now = uuid.uuid4().hex, datetime.now(timezone.utc).isoformat()
    if isinstance(attach, dict):
        attach = json.dumps(attach, ensure_ascii=False)
    rows = q("INSERT INTO messages(id,group_id,username,text,created_at,reply_to,forwarded_from,attach) VALUES(?,?,?,?,?,?,?,?) RETURNING seq",
             (mid, gid, username, text, now, reply_to, forwarded_from, attach or ""), commit=True)
    row = {"id": mid, "seq": rows[0]["seq"], "group_id": gid, "username": username, "text": text, "created_at": now,
           "edited": 0, "forwarded_from": forwarded_from, "reply_to": reply_to, "reply_text": None, "reply_user": None,
           "attach": attach or ""}
    if reply_to:
        parent = q("SELECT text, username FROM messages WHERE id=?", (reply_to,), one=True)
        if parent:
            row["reply_text"], row["reply_user"] = parent["text"], parent["username"]
    return shape(row, read_json(USERS_FILE, {}))


# ---------- languages ----------
# The whole UI is written in Persian; static/i18n.js (+ i18n-data.js) translates it in the browser for the other languages.
LANGS = [("fa", "فارسی"), ("en", "English"), ("ar", "العربية"), ("tr", "Türkçe"),
         ("ru", "Русский"), ("es", "Español"), ("fr", "Français"), ("zh", "中文")]
LANG_CODES = [c for c, _ in LANGS]
RTL_LANGS = {"fa", "ar"}
LANG_COOKIE = "lang"


def cookie_lang():
    """The language the visitor picked ('' when they have not picked one yet)."""
    c = request.cookies.get(LANG_COOKIE, "")
    return c if c in LANG_CODES else ""


def current_lang():
    return cookie_lang() or "fa"


def set_lang_cookie(resp, code):
    # not HttpOnly on purpose: static/i18n.js reads it to switch language and direction before the page renders
    resp.set_cookie(LANG_COOKIE, code, max_age=365 * 24 * 3600, samesite="Lax", path="/",
                    secure=bool(app.config.get("SESSION_COOKIE_SECURE")))
    return resp


def safe_next(p):
    p = str(p or "/")
    if (not p.startswith("/") or p.startswith("//") or "\\" in p or "\n" in p or "\r" in p
            or p.startswith("/lang") or len(p) > 300):
        return "/"
    return p


def sync_user_lang(resp, username):
    """The language chosen on this device is saved on the account; with no choice, the account's language is used."""
    chosen = cookie_lang()
    with data_lock:
        users = read_json(USERS_FILE, {})
        u = users.get(username)
        if u is None:
            return resp
        if chosen:
            if u.get("lang") != chosen:
                u["lang"] = chosen
                write_json(USERS_FILE, users)
        elif u.get("lang") in LANG_CODES:
            set_lang_cookie(resp, u["lang"])
    return resp


def need_lang_choice():
    """Redirect to the language picker the first time someone opens the login / signup / forgot pages."""
    if cookie_lang():
        return None
    return redirect(url_for("lang_page", next=request.path))


# ---------- helpers ----------
def logged_in(fn):
    @wraps(fn)
    def wrap(*a, **kw):
        if "username" not in session:
            return redirect(url_for("auth_page", section="chat"))
        return fn(*a, **kw)
    return wrap


def safe_user_public(u, full=False):
    d = {k: u.get(k, v) for k, v in {"username": "", "display_name": u.get("username", ""), "bio": "", "avatar": "🙂", "avatar_url": ""}.items()}
    d["show_phone"], d["show_email"] = bool(u.get("show_phone")), bool(u.get("show_email"))
    d["phone"] = u.get("phone", "") if (full or d["show_phone"]) else ""
    d["email"] = u.get("email", "") if (full or d["show_email"]) else ""
    d["premium"] = is_premium(u)
    d["show_online"] = u.get("show_online", True) is not False
    d["show_bio"] = u.get("show_bio", True) is not False
    if not (full or d["show_bio"]):
        d["bio"] = ""
    d["show_birthday"] = bool(u.get("show_birthday"))
    d["birthday"] = u.get("birthday", "") if (full or d["show_birthday"]) else ""
    d["show_avatar"] = u.get("show_avatar", True) is not False
    if not (full or d["show_avatar"]):
        d["avatar_url"], d["avatar"] = "", "🙂"
    d["dm_from"] = _dm_mode(u)                                     # everyone | contacts | nobody
    d["allow_dm"] = d["dm_from"] == "everyone"
    d["private_account"] = bool(u.get("private_account"))
    d["searchable"] = u.get("searchable", True) is not False      # False => hidden from user search
    if full:
        d["blocked"] = list(u.get("blocked") or [])
    return d


def _dm_mode(u):
    m = u.get("dm_from")
    if m in ("everyone", "contacts", "nobody"):
        return m
    return "everyone" if u.get("allow_dm", True) is not False else "contacts"


def is_blocked(users, a, b):
    """True if a has blocked b."""
    return b in ((users.get(a) or {}).get("blocked") or [])


def visible_users(username):
    allu, names = read_json(USERS_FILE, {}), {username}
    for g in my_groups(username).values():
        names.update(g["members"])
    return {n: safe_user_public(allu[n]) for n in names if n in allu}


def is_member(group, username):
    return username in group.get("members", [])


def public_group(g):
    return {"name": g.get("name", "گروه"), "description": g.get("description", ""), "members": g.get("members", []),
            "owner": g.get("owner", ""), "admins": g.get("admins", []), "type": g.get("type", "group"),
            "avatar_url": g.get("avatar_url", ""), "background": g.get("background", ""),
            "pins": g.get("pins", []), "only_admins_post": bool(g.get("only_admins_post", False)),
            "members_can_invite": bool(g.get("members_can_invite", True))}


def last_msg(gid):
    r = q("SELECT username,text,created_at,seq,attach FROM messages WHERE group_id=? ORDER BY seq DESC LIMIT 1", (gid,), one=True)
    return {"username": r["username"], "text": _preview(r["text"], r["attach"]), "created_at": r["created_at"], "seq": r["seq"]} if r else None


def last_msgs(gids):
    """Latest message of every group in a single query."""
    gids = list(gids)
    if not gids:
        return {}
    rows = q("SELECT m.group_id, m.username, m.text, m.created_at, m.seq, m.attach FROM messages m JOIN "
             "(SELECT group_id, MAX(seq) ms FROM messages WHERE group_id IN (" + ",".join("?" * len(gids)) + ") GROUP BY group_id) x "
             "ON x.ms = m.seq", tuple(gids))
    return {r["group_id"]: {"username": r["username"], "text": _preview(r["text"], r["attach"]), "created_at": r["created_at"], "seq": r["seq"]} for r in rows}


def my_groups(username):
    mine = {gid: g for gid, g in read_json(GROUPS_FILE, {}).items() if is_member(g, username)}
    lasts, out = last_msgs(mine), {}
    for gid, g in mine.items():
        d = public_group(g); d["last"] = lasts.get(gid)
        if g.get("type") == "dm" and not d["last"] and g.get("created_by") != username:
            continue  # an empty DM stays invisible to the other person
        out[gid] = d
    return out


def online_names():
    users = read_json(USERS_FILE, {})
    hidden = {n for n in set(online_sids.values()) if (users.get(n) or {}).get("show_online", True) is False}
    return sorted(set(online_sids.values()) - hidden)


def broadcast_presence():
    socketio.emit("presence", {"online": online_names()})


def login_user(username):
    pending_inv = session.get("pending_invite")
    insta_user = session.get("insta_username")          # Insta has its own account: never log it out
    session.clear()
    if insta_user:
        session["insta_username"] = insta_user
    session["username"] = username
    session.permanent = True
    return pending_inv


def start_session(username):
    inv = login_user(username)
    resp = redirect(url_for("join_invite", invite_code=inv)) if inv else redirect(url_for("chat"))
    return sync_user_lang(resp, username)


def join_sids(username, gid):
    for sid, u in list(online_sids.items()):
        if u == username:
            socketio.server.enter_room(sid, gid, namespace="/")


def dm_id(a, b):
    return "dm_" + hashlib.sha1("|".join(sorted([a, b])).encode()).hexdigest()[:16]


# ---------- verification codes (email / SMS) ----------
DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
CODE_TTL = 300
DEV_CODES = os.environ.get("CHATROOM_DEV_CODES", "0").strip() == "1"   # shows the code on screen: local testing ONLY
pending = {}        # signup token -> record (in memory, 5 min)
pending_reset = {}  # password-reset token -> record (in memory, 5 min)


def env(name, default=""):
    return (os.environ.get(name) or default).strip()


def rate_ok(key, limit, window):
    """Sliding-window limiter: True while `key` did fewer than `limit` actions in the last `window` seconds."""
    now, dq = time.time(), recent_sends[key]
    while dq and now - dq[0] > window:
        dq.popleft()
    if len(dq) >= limit:
        return False
    dq.append(now)
    if len(recent_sends) > 5000:
        for k in [k for k, v in recent_sends.items() if not v]:
            recent_sends.pop(k, None)
    return True


def client_ip():
    return request.remote_addr or "?"


def norm_email(e):
    e = str(e).strip().lower()
    return e if len(e) <= 120 and EMAIL_RE.match(e) else ""


def norm_phone(p):
    """Iranian mobiles -> 09xxxxxxxxx ; foreign numbers -> +<country><number> (E.164)."""
    p = re.sub(r"[\s\-().]", "", str(p).translate(DIGITS))
    if p.startswith("+98"): p = "0" + p[3:]
    elif p.startswith("0098"): p = "0" + p[4:]
    elif re.fullmatch(r"98\d{10}", p): p = "0" + p[2:]
    elif re.fullmatch(r"9\d{9}", p): p = "0" + p
    elif p.startswith("00") and len(p) > 4: p = "+" + p[2:]
    if re.fullmatch(r"09\d{9}", p) or re.fullmatch(r"\+[1-9]\d{7,14}", p):
        return p
    return ""


def parse_contact(raw):
    """One field, like Instagram: an '@' means email, otherwise phone. -> (email, phone, error)"""
    raw = str(raw or "").strip()
    if not raw:
        return "", "", "ایمیل یا شماره موبایل را وارد کن."
    if "@" in raw:
        e = norm_email(raw)
        return (e, "", "") if e else ("", "", "ایمیل معتبر نیست.")
    p = norm_phone(raw)
    return ("", p, "") if p else ("", "", "شماره موبایل معتبر نیست. شماره ایرانی را با ۰۹… و شماره خارجی را با + و کد کشور وارد کن.")


def new_captcha():
    a, b = random.randint(2, 9), random.randint(2, 9)
    session["captcha_answer"] = str(a + b)
    return f"{a} + {b} = ؟"


def captcha_ok(value):
    return str(value or "").translate(DIGITS).strip() == session.get("captcha_answer", "\0")


def find_user(ident, users=None):
    users = users if users is not None else read_json(USERS_FILE, {})
    low, em, ph = str(ident).strip().lower().lstrip("@"), norm_email(ident), norm_phone(ident)
    return next((n for n, u in users.items()
                 if n.lower() == low or (em and u.get("email") == em) or (ph and u.get("phone") == ph)), None)


def _http(url, data=None, headers=None, method=None, timeout=15):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


PURPOSE = {"signup": "تأیید ثبت‌نام", "reset": "بازیابی رمز عبور"}


# --- email: Gmail / any SMTP, or Brevo HTTP API (for hosts that block SMTP ports) ---
def _v4(host, port):
    return pysocket.getaddrinfo(host, port, pysocket.AF_INET, pysocket.SOCK_STREAM)[0][4][0]


class SMTP4(smtplib.SMTP):
    """SMTP over IPv4 only (hosts like Render can't reach Gmail over IPv6 and the connection just hangs)."""
    def _get_socket(self, host, port, timeout):
        return pysocket.create_connection((_v4(host, port), port), timeout)


class SMTP4_SSL(smtplib.SMTP_SSL):
    def _get_socket(self, host, port, timeout):
        sock = pysocket.create_connection((_v4(host, port), port), timeout)
        return self.context.wrap_socket(sock, server_hostname=host)


_gtoken = {"v": "", "exp": 0}


def gmail_api_ready():
    return bool(env("GMAIL_CLIENT_ID") and env("GMAIL_CLIENT_SECRET") and env("GMAIL_REFRESH_TOKEN"))


def _gmail_access_token():
    if _gtoken["v"] and time.time() < _gtoken["exp"] - 60:
        return _gtoken["v"]
    form = urllib.parse.urlencode({"client_id": env("GMAIL_CLIENT_ID"), "client_secret": env("GMAIL_CLIENT_SECRET"),
                                   "refresh_token": env("GMAIL_REFRESH_TOKEN"), "grant_type": "refresh_token"}).encode()
    status, out = _http("https://oauth2.googleapis.com/token", form, {"Content-Type": "application/x-www-form-urlencoded"}, "POST")
    if status != 200:
        raise RuntimeError(f"token refresh failed {status}: {out[:200]}")
    d = json.loads(out)
    _gtoken.update(v=d["access_token"], exp=time.time() + int(d.get("expires_in", 3000)))
    return _gtoken["v"]


def send_gmail_api(msg):
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    status, out = _http("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", json.dumps({"raw": raw}).encode(),
                        {"Authorization": "Bearer " + _gmail_access_token(), "Content-Type": "application/json"}, "POST")
    if not 200 <= status < 300:
        raise RuntimeError(f"gmail send failed {status}: {out[:300]}")


def smtp_settings():
    if env("GMAIL_USER") and env("GMAIL_APP_PASSWORD"):
        return "smtp.gmail.com", 587, env("GMAIL_USER"), env("GMAIL_APP_PASSWORD").replace(" ", ""), env("GMAIL_USER")
    if env("SMTP_HOST"):
        return (env("SMTP_HOST"), int(env("SMTP_PORT", "587")), env("SMTP_USER"), env("SMTP_PASS").replace(" ", ""),
                env("SMTP_FROM") or env("SMTP_USER"))
    return None


def email_ready():
    return bool(gmail_api_ready() or smtp_settings() or (env("BREVO_API_KEY") and env("BREVO_SENDER")))


def send_email(to, code, purpose="signup"):
    title = PURPOSE.get(purpose, "کد تأیید")
    brand = "ChatRoom | محمد مهدی آبزن"
    subject = f"{code} — کد تأیید {brand}"
    intro = {"signup": "برای ساخت حساب کاربری‌تان در ChatRoom، لطفاً کد زیر را در صفحه‌ی ثبت‌نام وارد کنید.",
             "reset": "درخواستی برای بازیابی رمز عبور حساب شما در ChatRoom ثبت شد. برای تعیین رمز جدید، کد زیر را وارد کنید."}.get(
        purpose, "برای ادامه، کد زیر را در ChatRoom وارد کنید.")
    text = (f"{brand}\n{title}\n\n{intro}\n\nکد تأیید شما: {code}\n\n"
            "این کد تا ۵ دقیقه معتبر است و فقط یک بار قابل استفاده است.\n"
            "برای حفظ امنیت حساب‌تان، این کد را هرگز با کسی در میان نگذارید؛ تیم ChatRoom هیچ‌گاه کد را از شما نمی‌پرسد.\n"
            "اگر خودتان این درخواست را ثبت نکرده‌اید، این ایمیل را نادیده بگیرید؛ هیچ تغییری در حساب شما ایجاد نخواهد شد.\n\n"
            "با احترام، تیم ChatRoom — محمد مهدی آبزن")
    logo = env("EMAIL_LOGO_URL")
    logo_tag = (f'<img src="{logo}" width="96" height="96" alt="ChatRoom" '
                f'style="display:block;margin:0 auto 14px;border-radius:50%;border:1px solid #4a4a52">') if logo else ""
    line = '<div style="height:1px;background:#2c2c33;margin:22px 0"></div>'
    html = (f'<div dir="rtl" style="background:#09090b;padding:28px 12px;font-family:Tahoma,Arial,sans-serif">'
            f'<div style="max-width:460px;margin:auto;background:#121215;border:1px solid #33333a;border-radius:18px;padding:30px 26px;text-align:center;color:#d9d9de">'
            f'{logo_tag}'
            f'<div style="letter-spacing:4px;font-size:12px;color:#8d8d97">CHAT ROOM</div>'
            f'<h2 style="margin:6px 0 2px;color:#f2f2f5;font-size:20px">ChatRoom | محمد مهدی آبزن</h2>'
            f'<p style="color:#a9a9b2;margin:0 0 6px;font-size:14px">{title}</p>{line}'
            f'<p style="color:#c4c4cb;font-size:14px;line-height:2.1;margin:0 0 16px">سلام 👋<br>{intro}</p>'
            f'<div style="font-size:36px;letter-spacing:10px;font-weight:700;direction:ltr;color:#fff;background:#1a1a1f;'
            f'border:1px solid #55555e;border-radius:12px;padding:16px">{code}</div>'
            f'<p style="color:#9a9aa3;font-size:13px;line-height:2.1;margin:16px 0 0">⏱ این کد تا <b style="color:#d9d9de">۵ دقیقه</b> معتبر است و فقط یک بار قابل استفاده است.</p>{line}'
            f'<p style="color:#8a8a93;font-size:12.5px;line-height:2.1;margin:0">🔒 این کد را هرگز با کسی در میان نگذارید؛ تیم ChatRoom هیچ‌گاه کد را از شما نمی‌پرسد.<br>'
            f'اگر خودتان این درخواست را ثبت نکرده‌اید، این ایمیل را نادیده بگیرید؛ هیچ تغییری در حساب شما ایجاد نمی‌شود.</p>{line}'
            f'<p style="color:#6f6f78;font-size:12px;margin:0">با احترام، تیم ChatRoom<br>محمد مهدی آبزن</p></div></div>')
    sender_addr = env("GMAIL_USER") or env("SMTP_FROM")
    msg = EmailMessage()
    msg["Subject"], msg["To"] = subject, to
    if sender_addr:
        msg["From"] = f"ChatRoom | محمد مهدی آبزن <{sender_addr}>"
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    if gmail_api_ready():
        try:
            send_gmail_api(msg)
            print("[email] sent via Gmail API")
            return True
        except Exception as e:
            print("[email] Gmail API failed:", repr(e))
    cfg = smtp_settings()
    if cfg:
        host, port, user, pwd, sender = cfg
        if not msg["From"]:
            msg["From"] = f"ChatRoom | محمد مهدی آبزن <{sender}>"
        ctx = ssl.create_default_context()
        for prt in dict.fromkeys([port, 465, 587]):          # configured port first, then the other standard one
            try:
                if prt == 465:
                    with SMTP4_SSL(host, prt, timeout=12, context=ctx) as srv:
                        if user: srv.login(user, pwd)
                        srv.send_message(msg)
                else:
                    with SMTP4(host, prt, timeout=12) as srv:
                        srv.ehlo(); srv.starttls(context=ctx); srv.ehlo()
                        if user: srv.login(user, pwd)
                        srv.send_message(msg)
                print(f"[email] sent via {host}:{prt}")
                return True
            except Exception as e:
                print(f"[email] SMTP {host}:{prt} failed:", repr(e))
    if env("BREVO_API_KEY") and env("BREVO_SENDER"):
        try:
            body = json.dumps({"sender": {"name": "ChatRoom | محمد مهدی آبزن", "email": env("BREVO_SENDER")}, "to": [{"email": to}],
                               "subject": subject, "htmlContent": html, "textContent": text}).encode()
            status, out = _http("https://api.brevo.com/v3/smtp/email", body, {"api-key": env("BREVO_API_KEY"),
                                "Content-Type": "application/json", "accept": "application/json"}, "POST")
            if 200 <= status < 300:
                return True
            print("[email] Brevo failed:", status, out[:200])
        except Exception as e:
            print("[email] Brevo failed:", repr(e))
    return False


# --- SMS: Kavenegar / SMS.ir (Iranian numbers) and Twilio (any country) ---
def sms_ready():
    return bool(env("KAVENEGAR_KEY") or (env("SMSIR_KEY") and env("SMSIR_TEMPLATE")) or _twilio_ready())


def _sms_kavenegar(phone, code):
    key, tpl = env("KAVENEGAR_KEY"), env("KAVENEGAR_TEMPLATE")
    if not key:
        return False
    if tpl:   # verify-lookup (recommended: needs an approved template with %token)
        url = f"https://api.kavenegar.com/v1/{key}/verify/lookup.json?" + urllib.parse.urlencode({"receptor": phone, "token": code, "template": tpl})
    else:     # plain send (needs your sender line)
        q_ = {"receptor": phone, "message": f"کد تأیید Chatroom: {code}"}
        if env("KAVENEGAR_SENDER"): q_["sender"] = env("KAVENEGAR_SENDER")
        url = f"https://api.kavenegar.com/v1/{key}/sms/send.json?" + urllib.parse.urlencode(q_)
    status, out = _http(url)
    ok = status == 200 and '"status":200' in out.replace(" ", "")
    if not ok: print("[sms] Kavenegar failed:", status, out[:200])
    return ok


def _sms_smsir(phone, code):
    if not (env("SMSIR_KEY") and env("SMSIR_TEMPLATE")):
        return False
    body = json.dumps({"mobile": phone, "templateId": int(env("SMSIR_TEMPLATE")),
                       "parameters": [{"name": env("SMSIR_PARAM", "Code"), "value": code}]}).encode()
    status, out = _http("https://api.sms.ir/v1/send/verify", body, {"x-api-key": env("SMSIR_KEY"),
                        "Content-Type": "application/json", "Accept": "application/json"}, "POST")
    ok = status == 200 and '"status":1' in out.replace(" ", "")
    if not ok: print("[sms] SMS.ir failed:", status, out[:200])
    return ok


def _sms_twilio(phone, code):
    sid, tok = env("TWILIO_SID"), env("TWILIO_TOKEN")
    if not (sid and tok and (env("TWILIO_FROM") or env("TWILIO_MESSAGING_SID"))):
        return False
    to = "+98" + phone[1:] if phone.startswith("09") else phone
    form = {"To": to, "Body": f"کد تأیید Chatroom: {code}"}
    if env("TWILIO_MESSAGING_SID"): form["MessagingServiceSid"] = env("TWILIO_MESSAGING_SID")
    else: form["From"] = env("TWILIO_FROM")
    auth = base64.b64encode(f"{sid}:{tok}".encode()).decode()
    status, out = _http(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", urllib.parse.urlencode(form).encode(),
                        {"Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded"}, "POST")
    if status not in (200, 201): print("[sms] Twilio failed:", status, out[:200])
    return status in (200, 201)


def send_sms(phone, code, purpose="signup"):
    providers = [_sms_kavenegar, _sms_smsir, _sms_twilio] if phone.startswith("09") else [_sms_twilio]
    for fn in providers:
        try:
            if fn(phone, code):
                return True
        except Exception as e:
            print(f"[sms] {fn.__name__} error:", repr(e))
    return False


def deliver_code(email, phone, code, purpose="signup"):
    ok = False
    if email: ok = send_email(email, code, purpose) or ok
    if phone: ok = send_sms(phone, code, purpose) or ok
    return ok


def mask(email="", phone=""):
    out = []
    if email:
        a, d = email.split("@", 1); out.append(a[:2] + "***@" + d)
    if phone:
        out.append(phone[:4] + "***" + phone[-3:])
    return out


def sms_ready_for(phone):
    if phone.startswith("09"):
        return bool(env("KAVENEGAR_KEY") or (env("SMSIR_KEY") and env("SMSIR_TEMPLATE")) or _twilio_ready())
    return _twilio_ready()


def _twilio_ready():
    return bool(env("TWILIO_SID") and env("TWILIO_TOKEN") and (env("TWILIO_FROM") or env("TWILIO_MESSAGING_SID")))


def channel_missing(email, phone):
    """Friendly error when the server has no provider for the chosen channel (and dev codes are off)."""
    if DEV_CODES:
        return ""
    if email and not email_ready():
        return "ارسال ایمیل روی این سرور تنظیم نشده است؛ مدیر سایت باید Gmail یا SMTP را تنظیم کند."
    if phone and not sms_ready_for(phone):
        return ("ارسال پیامک برای این شماره روی سرور تنظیم نشده است؛ مدیر سایت باید سرویس پیامک را تنظیم کند."
                if phone.startswith("09") else "برای شماره‌های خارجی، سرویس پیامک بین‌المللی (Twilio) باید تنظیم شود. می‌توانی با ایمیل ثبت‌نام کنی.")
    return ""


def new_code():
    return f"{secrets.randbelow(10**6):06d}"


def startup_report():
    print("  async  :", ASYNC_MODE)
    print("\n  storage:", "Postgres (data is permanent)" if USE_PG else "local files (lost on every Render restart!)")
    print(f"\n  files  : photos & files up to {MAX_FILE_MB} MB")
    print("\n  languages:", ", ".join(LANG_CODES))
    print("\n  ---- verification codes ----")
    print("  email :", "READY" if email_ready() else "NOT configured (set GMAIL_USER + GMAIL_APP_PASSWORD)")
    print("  sms   :", "READY" if sms_ready() else "NOT configured (set KAVENEGAR_KEY / SMSIR_KEY / TWILIO_*)")
    if DEV_CODES:
        print("  !! CHATROOM_DEV_CODES=1 -> codes are shown on screen. Never use this on a public server.")


# ---------- ChatRoom assistant bot (a private chat every account gets) ----------
BOT_USER = "chatroom_bot"
BOT_PROFILE = {"display_name": "ChatRoom | محمد مهدی آبزن", "bio": "دستیار رسمی ChatRoom؛ آموزش، راهنما و پاسخ به پرسش‌های شما",
               "avatar": "🤖", "avatar_url": "/bot-avatar.webp?v=3"}

BOT_WELCOME = (
    "سلام به ChatRoom | محمد مهدی آبزن خوش آمدید! 👋\n"
    "اینجا خانه‌ی گفتگوهای سریع، خصوصی و منظم شماست.\n"
    "من دستیار ChatRoom هستم و هر زمان به راهنمایی نیاز داشتید، در کنارتان خواهم بود.\n"
    "می‌توانید پیام خصوصی بفرستید، گروه بسازید، دوستانتان را با لینک دعوت به گفتگو بیاورید و ظاهر برنامه را با تم‌ها و فونت‌های دلخواه تغییر دهید.\n"
    "اگر بخشی از برنامه برایتان ناآشناست، کافی است عدد یکی از گزینه‌های زیر را برایم بفرستید تا با کمال میل توضیح دهم."
)

BOT_MENU = (
    "📋 منوی راهنما\n"
    "۱ ـ شروع کار با برنامه\n"
    "۲ ـ ساخت گروه و دعوت دوستان\n"
    "۳ ـ پیام خصوصی و جستجوی کاربران\n"
    "۴ ـ تغییر تم و فونت\n"
    "۵ ـ ویرایش پروفایل و حریم خصوصی\n"
    "۶ ـ ویژگی‌های برنامه\n"
    "۷ ـ آیا این برنامه پیشرفته‌تر خواهد شد؟\n"
    "۸ ـ ارتباط با پشتیبانی\n"
    "\nبرای دیدن دوباره‌ی این منو، کلمه‌ی «منو» را بفرستید."
)

BOT_ANSWERS = {
    "1": ("🚀 شروع کار\n"
          "۱. از ستون کناری، گفتگوهای خود را می‌بینید؛ برای جستجو، نام گفتگو یا نام کاربری را در کادر بالای ستون بنویسید.\n"
          "۲. با دکمه‌ی «+» یک گروه جدید می‌سازید.\n"
          "۳. پیام را در کادر پایین بنویسید و دکمه‌ی ➤ را بزنید؛ با دکمه‌ی 📎 هم می‌توانید عکس و فایل بفرستید.\n"
          "۴. با نگه داشتن یا کلیک روی یک پیام می‌توانید پاسخ بدهید، ویرایش کنید، حذف کنید یا آن را به گفتگوی دیگری بفرستید؛ ویرایش و حذف فقط برای پیام‌های خودتان ممکن است (ادمین‌های گروه می‌توانند پیام‌های دیگران را هم حذف کنند).\n"
          "۵. تنظیمات، پشتیبانی و خروج از حساب در پایین ستون کناری قرار دارند."),
    "2": ("👥 ساخت گروه و دعوت دوستان\n"
          "۱. دکمه‌ی «+» را بزنید، نام و توضیحات گروه را بنویسید و «ساخت گروه» را انتخاب کنید؛ سازنده‌ی گروه، مالک آن می‌شود.\n"
          "۲. داخل گروه روی «لینک دعوت» بزنید تا لینک کپی شود و آن را برای دوستانتان بفرستید؛ هر کس با آن وارد شود، عضو گروه می‌شود.\n"
          "۳. فهرست اعضا از دکمه‌ی «اعضا» در بالای صفحه نمایش داده می‌شود.\n"
          "۴. مالک و ادمین‌ها می‌توانند از «تنظیمات» عکس، نام و توضیحات گروه را تغییر دهند؛ مالک می‌تواند ادمین تعیین کند، مالکیت را منتقل کند یا گروه را حذف کند؛ مالک و ادمین‌ها می‌توانند اعضا را حذف کنند."),
    "3": ("💬 پیام خصوصی و جستجوی کاربران\n"
          "۱. نام کاربری یا نام نمایشی فرد را در کادر جستجو بنویسید (حداقل دو حرف).\n"
          "۲. روی نام او بزنید و گزینه‌ی «ارسال پیام» را انتخاب کنید.\n"
          "۳. گفتگوی خصوصی تا زمانی که اولین پیام ارسال نشود، برای طرف مقابل نمایش داده نمی‌شود."),
    "4": ("🎨 تم و فونت\n"
          "۱. «تنظیمات» را در ستون کناری باز کنید.\n"
          "۲. «🎨 تم‌ها» را برای انتخاب از میان ۱۶ تم تیره و روشن بزنید.\n"
          "۳. «🔤 فونت‌ها» را برای انتخاب فونت و تغییر اندازه‌ی متن بزنید.\n"
          "این دو دکمه در پایین صفحه‌ی ورود هم هستند و انتخاب شما روی همان دستگاه ذخیره می‌شود."),
    "5": ("👤 پروفایل و حریم خصوصی\n"
          "۱. روی نام خود، پایین ستون کناری بزنید یا «تنظیمات» را باز کنید.\n"
          "۲. عکس، ایموجی، نام نمایشی و بیو را تغییر دهید و «ذخیره» را بزنید.\n"
          "۳. شماره و ایمیل شما به‌صورت پیش‌فرض برای دیگران پنهان است؛ فقط با روشن کردن «نمایش شماره» یا «نمایش ایمیل» دیده می‌شوند.\n"
          "۴. اگر رمز عبورتان را فراموش کردید، از صفحه‌ی ورود گزینه‌ی «رمز خود را فراموش کرده‌اید؟» را انتخاب کنید."),
    "6": ("✨ ویژگی‌های ChatRoom\n"
          "• ارسال و دریافت لحظه‌ای پیام‌ها\n"
          "• ارسال عکس، ویدیو، صوت و فایل\n"
          "• پیام خصوصی و گروه‌های دعوت‌محور با عکس پروفایل گروه\n"
          "• مدیریت گروه: مالک، ادمین، حذف عضو و انتقال مالکیت\n"
          "• پاسخ، ویرایش، حذف و فوروارد پیام\n"
          "• نمایش وضعیت آنلاین بودن و در حال نوشتن\n"
          "• ۱۶ تم رنگی و بیش از ۳۰ فونت فارسی\n"
          "• قابلیت نصب روی موبایل و کامپیوتر (PWA)\n"
          "• ثبت‌نام و بازیابی رمز با ایمیل یا پیامک\n"
          "• حفظ حریم خصوصی: شماره و ایمیل فقط با اجازه‌ی خودتان نمایش داده می‌شود"),
    "7": ("🔮 آیا ChatRoom پیشرفته‌تر خواهد شد؟\n"
          "بله! ChatRoom یک پروژه‌ی زنده است و توسعه‌ی آن ادامه دارد. هدف ما سریع‌تر، امن‌تر و کاربردی‌تر شدن برنامه است و پیشنهادهای شما در این مسیر نقش مهمی دارند.\n"
          "اگر ایده یا مشکلی دارید، از بخش «پشتیبانی» برایمان بنویسید؛ همه‌ی پیام‌ها خوانده می‌شود. 💙"),
    "8": ("🛟 پشتیبانی\n"
          "برای گزارش مشکل، پرسش یا پیشنهاد، به صفحه‌ی /support بروید (از ستون کناری، گزینه‌ی «پشتیبانی») و فرم را پر کنید. پس از ارسال، یک کد پیگیری دریافت می‌کنید."),
}
BOT_ALIASES = {"شروع": "1", "start": "1", "/start": "1", "گروه": "2", "دعوت": "2", "پیام خصوصی": "3", "جستجو": "3",
               "تم": "4", "فونت": "4", "پروفایل": "5", "حریم خصوصی": "5", "ویژگی": "6", "ویژگی ها": "6", "ویژگی‌ها": "6",
               "پیشرفته": "7", "آینده": "7", "پشتیبانی": "8"}
BOT_MENU_WORDS = {"منو", "menu", "/menu", "راهنما", "help", "/help", "سلام", "hi", "hello"}


BOT_AVATAR_B64 = (
    "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"
    "AkKoEAFd3kvgZAAlctgkWOAAAA=="
)


BUILD = "2026-11-05-r10"


@app.route("/api/build")
def build_info():
    """Open /api/build in the browser to check which version of the server is really running."""
    users = read_json(USERS_FILE, {})
    return jsonify(build=BUILD, asset_v=app.jinja_env.globals.get("ASSET_V"),
                   bot_avatar=(users.get(BOT_USER) or {}).get("avatar_url"))


@app.route("/bot-avatar.webp")
def bot_avatar():
    """The assistant's profile picture (embedded, so no static file is needed)."""
    return Response(base64.b64decode(BOT_AVATAR_B64), mimetype="image/webp",
                    headers={"Cache-Control": "public, max-age=86400"})


def ensure_bot():
    """Create/refresh the bot account (it has a random password, so nobody can log in as it)."""
    with data_lock:
        users = read_json(USERS_FILE, {})
        u = users.get(BOT_USER)
        if not u:
            u = {"username": BOT_USER, "password_hash": generate_password_hash(secrets.token_hex(32)), "email": "", "phone": "",
                 "show_email": False, "show_phone": False, "created_at": datetime.now(timezone.utc).isoformat()}
            users[BOT_USER] = u
        u.update(BOT_PROFILE)
        write_json(USERS_FILE, users)


try:
    ensure_bot()        # create/refresh the assistant account (name, bio, profile picture) on every start
except Exception as _e:
    print("ensure_bot failed:", _e)


def bot_send(gid, text, notify=True):
    m = insert_message(gid, BOT_USER, text)
    if notify:
        socketio.emit("new_message", m, to=gid)
    return m


def onboard_bot_chat(username, notify=False):
    """Give `username` its private chat with the bot (idempotent) and send the welcome messages once."""
    if username == BOT_USER:
        return
    gid = dm_id(username, BOT_USER)
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        if gid not in groups:
            groups[gid] = {"name": "", "description": "", "members": [username, BOT_USER], "owner": "", "type": "dm",
                           "created_by": BOT_USER, "invite_code": secrets.token_urlsafe(12)}
            write_json(GROUPS_FILE, groups)
    if not q("SELECT 1 FROM messages WHERE group_id=? LIMIT 1", (gid,), one=True):
        bot_send(gid, BOT_WELCOME, notify)
        bot_send(gid, BOT_MENU, notify)


def bot_respond(gid, text):
    try:
        t = str(text or "").translate(DIGITS).strip().lower().strip("«»\"'.!؟? ")
        key = t if t in BOT_ANSWERS else BOT_ALIASES.get(t, "")
        if key:
            bot_send(gid, BOT_ANSWERS[key] + "\n\nبرای بازگشت به منو، «منو» را بفرستید.")
        elif t in BOT_MENU_WORDS:
            bot_send(gid, BOT_MENU)
        else:
            bot_send(gid, "متوجه پیامتان نشدم 🙏 لطفاً عدد یکی از گزینه‌های منو را بفرستید.\n\n" + BOT_MENU)
    except Exception as e:
        print("[bot] error:", repr(e))


# ---------- pages ----------
@app.route("/healthz")
def healthz():
    return jsonify(status="ok"), 200


@app.route("/manifest.webmanifest")
def manifest():
    icon = lambda f, sz, purpose="any": {"src": "/static/icons/" + f, "sizes": sz, "type": "image/png", "purpose": purpose}
    return jsonify({
        "name": "Chatroom | محمد مهدی آبزن", "short_name": "Chatroom", "lang": "fa", "dir": "rtl",
        "start_url": "/chat", "scope": "/", "display": "standalone",
        "background_color": "#000000", "theme_color": "#000000",
        "icons": [icon("icon-192.png", "192x192"), icon("icon-512.png", "512x512"),
                  icon("maskable-512.png", "512x512", "maskable")],
    }), 200, {"Content-Type": "application/manifest+json"}


@app.route("/sw.js")
def service_worker():
    resp = app.response_class(render_template("sw.js"), mimetype="application/javascript")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.route("/offline")
def offline():
    return ('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>آفلاین</title><body style="font-family:system-ui;background:#1A1230;color:#F5EDF8;display:grid;place-items:center;height:100vh;margin:0;text-align:center">'
            '<div><h1>اتصال برقرار نیست</h1><p>اینترنتت را بررسی کن؛ پیام‌هایت امن هستند و بعد از وصل شدن برمی‌گردند.</p>'
            '<button onclick="location.reload()" style="padding:10px 22px;border-radius:12px;border:0;background:#E5385E;color:#fff;font:inherit">تلاش دوباره</button></div>')


@app.route("/favicon.ico")
def favicon():
    return redirect("/static/icons/icon-192.png")


@app.route("/media/<path:filename>")
def media(filename):
    """Serves avatars and chat attachments. Images / audio / video show inline; everything else is a download."""
    ext = os.path.splitext(filename)[1].lower()
    inline_mime = INLINE_MIME.get(ext)
    dl = clean_filename(request.args.get("n")) if request.args.get("n") else os.path.basename(filename)
    headers = {"Cache-Control": "public, max-age=2592000", "X-Content-Type-Options": "nosniff",
               "Content-Disposition": _disposition(bool(inline_mime), dl)}
    if USE_PG:
        rows = q("SELECT data FROM media WHERE name=?", (filename,))
        if not rows:
            abort(404)
        blob = bytes(rows[0]["data"])
        rng = re.match(r"bytes=(\d*)-(\d*)$", request.headers.get("Range", ""))
        if rng and (rng.group(1) or rng.group(2)):
            total = len(blob)
            if rng.group(1):
                a = int(rng.group(1)); b = int(rng.group(2)) if rng.group(2) else total - 1
            else:
                a = max(0, total - int(rng.group(2))); b = total - 1
            b = min(b, total - 1)
            if a > b or a >= total:
                return Response(status=416, headers={"Content-Range": f"bytes */{total}"})
            h2 = dict(headers, **{"Content-Range": f"bytes {a}-{b}/{total}", "Accept-Ranges": "bytes"})
            return Response(blob[a:b + 1], status=206, mimetype=inline_mime or "application/octet-stream", headers=h2)
        headers["Accept-Ranges"] = "bytes"
        return Response(blob, mimetype=inline_mime or "application/octet-stream", headers=headers)
    resp = send_from_directory(UPLOAD_DIR, filename, mimetype=inline_mime or "application/octet-stream", max_age=30 * 24 * 3600)
    resp.headers.update(headers)
    return resp


@app.route("/api/me")
def me():
    return (jsonify(ok=True, username=session["username"]), 200) if "username" in session else (jsonify(ok=False), 401)


def api_login(fn):
    @wraps(fn)
    def wrap(*a, **kw):
        if "username" not in session:
            return jsonify(error="نشست تو تمام شده؛ دوباره وارد شو."), 401
        return fn(*a, **kw)
    return wrap


# ---------- background personal chat: synced to the user's account ----------
@app.route("/api/me/background", methods=["GET", "POST"])
@api_login
def me_background():
    username = session["username"]
    if request.method == "GET":
        users = read_json(USERS_FILE, {})
        user = users.get(username)
        if not user:
            return _err("کاربر پیدا نشد.", 404)
        return jsonify(ok=True, background=str(user.get("chat_background", "") or ""))

    photo = request.files.get("photo")
    preset = str(request.form.get("preset", "")).strip().lower()
    remove = request.form.get("remove") == "1"
    old = ""
    new_background = ""
    with data_lock:
        users = read_json(USERS_FILE, {})
        user = users.get(username)
        if not user:
            return _err("کاربر پیدا نشد.", 404)
        old = str(user.get("chat_background", "") or "")
        if remove:
            new_background = ""
        elif preset:
            if not BG_PRESET_RE.fullmatch(preset):
                return _err("پس‌زمینه نامعتبر است.")
            new_background = "p:" + preset
        elif photo and photo.filename:
            ext = os.path.splitext(secure_filename(photo.filename))[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                return _err("فرمت عکس پشتیبانی نمی‌شود.")
            data = photo.read(MAX_IMAGE_SIZE + 1)
            if len(data) > MAX_IMAGE_SIZE:
                return _err("حجم عکس باید کمتر از ۴ مگابایت باشد.")
            if not data or not looks_like_image(data[:16]):
                return _err("فایل تصویر معتبر نیست.")
            filename = uuid.uuid4().hex + ext
            store_media(filename, IMAGE_MIME[ext], data)
            new_background = "/media/" + filename
        else:
            return _err("پس‌زمینه‌ای انتخاب نشده است.")
        user["chat_background"] = new_background
        write_json(USERS_FILE, users)
    if old and old != new_background:
        remove_media_url(old)
    return jsonify(ok=True, background=new_background)


_DUMMY_HASH = generate_password_hash("not-a-real-password")


# ----- language picker -----
@app.route("/lang")
def lang_page():
    return render_template("lang.html", nxt=safe_next(request.args.get("next")), current=current_lang())


@app.route("/lang/<code>")
def set_lang(code):
    if code not in LANG_CODES:
        abort(404)
    resp = redirect(safe_next(request.args.get("next")))
    set_lang_cookie(resp, code)
    if "username" in session:                       # logged-in users keep their choice on the account
        with data_lock:
            users = read_json(USERS_FILE, {})
            u = users.get(session["username"])
            if u is not None and u.get("lang") != code:
                u["lang"] = code
                write_json(USERS_FILE, users)
    return resp


# ---------- landing: choose Chatroom or Insta ----------
@app.route("/", methods=["GET"])
def index():
    pick = need_lang_choice()                      # first visit: ask for the language
    if pick:
        return pick
    return render_template("landing.html", chat_in="username" in session, insta_in="insta_username" in session)


# ---------- one sign-in / sign-up gate per section ----------
GATE_SECTIONS = ("chat", "insta")


@app.route("/auth/<section>")
def auth_page(section):
    if section not in GATE_SECTIONS:                # unknown section -> back to the two doors
        return redirect(url_for("index"))
    if section == "chat" and "username" in session:
        return redirect(url_for("chat"))
    if section == "insta" and "insta_username" in session:
        return redirect("/insta")
    need = section == "chat" and session.get("login_fails", 0) >= 3
    question = new_captcha() if section == "chat" else ""     # chat sign-up always needs the sum
    return render_template("gate.html", section=section, need_captcha=need, captcha_question=question,
                           dev_codes=DEV_CODES)


@app.route("/login")
def login_alias():                                   # old links keep working
    return redirect(url_for("auth_page", section="chat"))


@app.route("/api/chat/login", methods=["POST"])
def chat_login_api():
    p = request.get_json(silent=True)
    if not isinstance(p, dict):
        return jsonify(error="درخواست نامعتبر است."), 400
    ident, password = p.get("identifier"), p.get("password")
    if not isinstance(ident, str) or not isinstance(password, str):
        return jsonify(error="نام کاربری و رمز عبور را درست وارد کن."), 400
    ident = ident.strip()[:120]
    if not ident:
        return jsonify(error="نام کاربری، ایمیل یا شماره را وارد کن."), 400
    if not password:
        return jsonify(error="رمز عبور را وارد کن."), 400
    if len(password) > 256:
        return jsonify(error="رمز عبور خیلی طولانی است."), 400
    if not rate_ok("login-ip:" + client_ip(), 120, 600) or not rate_ok("login:" + client_ip() + ":" + ident.lower(), 8, 600):
        return jsonify(error="تعداد تلاش‌ها زیاد بود؛ چند دقیقه بعد دوباره امتحان کن."), 429
    need = session.get("login_fails", 0) >= 3        # captcha only after repeated failures
    if need and not captcha_ok(p.get("captcha")):
        return jsonify(error="تأیید ربات ناموفق بود؛ حاصل جمع را درست وارد کن.", captcha_required=True,
                       captcha=new_captcha()), 400
    users = read_json(USERS_FILE, {})
    name = find_user(ident, users)
    good = check_password_hash(users[name].get("password_hash", ""), password) if name else (check_password_hash(_DUMMY_HASH, password) and False)
    if not name or not good:
        session["login_fails"] = session.get("login_fails", 0) + 1
        out = {"error": "نام کاربری یا رمز عبور درست نیست."}
        if session["login_fails"] >= 3:
            out.update(captcha_required=True, captcha=new_captcha())
        return jsonify(out), 401
    inv = login_user(name)
    resp = jsonify(ok=True, redirect=url_for("join_invite", invite_code=inv) if inv else url_for("chat"))
    return sync_user_lang(resp, name)


@app.route("/signup")
def signup_page():
    if "username" in session:
        return redirect(url_for("chat"))
    pick = need_lang_choice()
    if pick:
        return pick
    return render_template("signup.html", captcha_question=new_captcha())


@app.route("/forgot")
def forgot_page():
    if "username" in session:
        return redirect(url_for("chat"))
    pick = need_lang_choice()
    if pick:
        return pick
    return render_template("forgot.html", captcha_question=new_captcha())


@app.route("/api/signup/start", methods=["POST"])
def signup_start():
    p = request.get_json(silent=True)
    fail = lambda m, c=400: (jsonify(error=m, captcha=new_captcha()), c)
    if not isinstance(p, dict):
        return fail("درخواست نامعتبر است.")
    for key in ("username", "password", "contact", "display_name", "captcha"):    # TypeError guard: only text/numbers
        if p.get(key) is not None and (isinstance(p[key], bool) or not isinstance(p[key], (str, int))):
            return fail("مقدار یکی از فیلدها معتبر نیست.")
    if not captcha_ok(p.get("captcha")):
        return fail("تأیید ربات ناموفق بود؛ حاصل جمع را درست وارد کن.")
    username, password = str(p.get("username", "")).strip(), str(p.get("password", ""))
    contact = p.get("contact") or p.get("email") or p.get("phone")      # one field: email OR phone
    email, phone, err = parse_contact(contact)
    if err:
        return fail(err)
    if not re.fullmatch(r"[A-Za-z0-9_]{3,20}", username):
        return fail("نام کاربری باید ۳ تا ۲۰ حرف انگلیسی، عدد یا زیرخط (_) باشد.")
    if len(password) < 8:
        return fail("رمز عبور باید حداقل ۸ کاراکتر باشد.")
    if len(password) > 128:
        return fail("رمز عبور نباید بیشتر از ۱۲۸ کاراکتر باشد.")
    users = read_json(USERS_FILE, {})
    if any(n.lower() == username.lower() for n in users):
        return fail("این نام کاربری قبلاً گرفته شده است.")
    if email and any(u.get("email") == email for u in users.values()):
        return fail("با این ایمیل قبلاً حساب ساخته شده است.")
    if phone and any(u.get("phone") == phone for u in users.values()):
        return fail("با این شماره قبلاً حساب ساخته شده است.")
    target = email or phone
    if not rate_ok("su-ip:" + client_ip(), 10, 600) or not rate_ok("su-to:" + target, 3, 600):
        return fail("تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کن.", 429)
    miss = channel_missing(email, phone)
    if miss:
        return fail(miss, 503)
    rec = {"username": username, "password_hash": generate_password_hash(password), "email": email, "phone": phone,
           "display_name": str(p.get("display_name", "")).strip()[:32] or username,
           "code": new_code(), "exp": time.time() + CODE_TTL, "tries": 0, "sent_at": time.time()}
    sent = deliver_code(email, phone, rec["code"], "signup")
    out = {"ok": True, "sent_to": mask(email, phone), "channel": "email" if email else "sms"}
    if not sent:
        if not DEV_CODES:
            return fail("ارسال کد ناموفق بود. اطلاعات را بررسی کن و کمی بعد دوباره تلاش کن.", 503)
        print(f"[DEV] verification code for {username}: {rec['code']}")
        out["dev_code"] = rec["code"]
    token = secrets.token_urlsafe(16)
    with data_lock:
        for k in [k for k, v in pending.items() if v["exp"] < time.time()]:
            pending.pop(k, None)
        pending[token] = rec
    session["signup_token"] = token
    return jsonify(out)


@app.route("/api/signup/resend", methods=["POST"])
def signup_resend():
    rec = pending.get(session.get("signup_token"))
    if not rec or rec["exp"] < time.time():
        return jsonify(error="جلسه ثبت‌نام منقضی شد؛ از اول شروع کن."), 400
    if time.time() - rec["sent_at"] < 30:
        return jsonify(error="۳۰ ثانیه صبر کن و دوباره تلاش کن."), 429
    if not rate_ok("su-to:" + (rec["email"] or rec["phone"]), 3, 600):
        return jsonify(error="تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کن."), 429
    rec.update(code=new_code(), exp=time.time() + CODE_TTL, tries=0, sent_at=time.time())
    sent = deliver_code(rec["email"], rec["phone"], rec["code"], "signup")
    out = {"ok": True}
    if not sent:
        if not DEV_CODES:
            return jsonify(error="ارسال کد ناموفق بود؛ کمی بعد دوباره تلاش کن."), 503
        out["dev_code"] = rec["code"]
    return jsonify(out)


@app.route("/api/signup/verify", methods=["POST"])
def signup_verify():
    token = session.get("signup_token")
    rec = pending.get(token)
    body = request.get_json(silent=True)
    raw_code = body.get("code", "") if isinstance(body, dict) else ""
    if isinstance(raw_code, bool) or not isinstance(raw_code, (str, int)):
        return jsonify(error="کد را درست وارد کن."), 400
    code = str(raw_code).translate(DIGITS).strip()
    if not rec or rec["exp"] < time.time():
        return jsonify(error="کد منقضی شده؛ از اول ثبت‌نام کن."), 400
    if not re.fullmatch(r"\d{6}", code):
        return jsonify(error="کد باید ۶ رقم باشد."), 400
    rec["tries"] += 1
    if rec["tries"] > 5:
        pending.pop(token, None)
        return jsonify(error="تعداد تلاش‌ها زیاد بود؛ دوباره ثبت‌نام کن."), 429
    if not hmac.compare_digest(rec["code"], code):
        return jsonify(error="کد اشتباه است."), 400
    lang = cookie_lang() or "fa"                      # the language picked before signing up is saved on the new account
    with data_lock:
        users = read_json(USERS_FILE, {})
        if any(n.lower() == rec["username"].lower() for n in users):
            return jsonify(error="این نام کاربری همین الان گرفته شد."), 409
        users[rec["username"]] = {"username": rec["username"], "password_hash": rec["password_hash"], "display_name": rec["display_name"],
                                  "bio": "", "avatar": "🙂", "avatar_url": "", "email": rec["email"], "phone": rec["phone"],
                                  "show_email": False, "show_phone": False, "lang": lang,
                                  "created_at": datetime.now(timezone.utc).isoformat()}
        write_json(USERS_FILE, users)
    pending.pop(token, None)
    session.pop("signup_token", None)
    onboard_bot_chat(rec["username"])
    # no auto-login: the person signs in on purpose (a pending invite link stays in the session)
    resp = jsonify(ok=True, registered=True, message="حساب ساخته شد. حالا وارد شو.")
    return set_lang_cookie(resp, lang)


# ----- forgot password: identifier -> code -> new password -----
@app.route("/api/forgot/start", methods=["POST"])
def forgot_start():
    p = request.get_json(silent=True) or {}
    fail = lambda m, c=400: (jsonify(error=m, captcha=new_captcha()), c)
    if not captcha_ok(p.get("captcha")):
        return fail("تأیید ربات ناموفق بود؛ حاصل جمع را درست وارد کن.")
    ident = str(p.get("identifier", "")).strip()[:120]
    if len(ident) < 3:
        return fail("نام کاربری، ایمیل یا شماره موبایل را وارد کن.")
    if not rate_ok("fg-ip:" + client_ip(), 10, 600) or not rate_ok("fg-id:" + ident.lower(), 3, 600):
        return fail("تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کن.", 429)
    if not DEV_CODES and not (email_ready() or sms_ready()):
        return fail("ارسال کد روی این سرور تنظیم نشده است؛ مدیر سایت باید ایمیل یا پیامک را تنظیم کند.", 503)
    users = read_json(USERS_FILE, {})
    name = find_user(ident, users)
    rec = {"username": name or "", "valid": bool(name), "email": "", "phone": "", "code": new_code(),
           "exp": time.time() + CODE_TTL, "tries": 0, "sent_at": time.time()}
    out = {"ok": True}
    if not name:
        print(f"[reset] no account matches {ident!r} (users in database: {len(users)})")
    if name:
        u, em, ph = users[name], norm_email(ident), norm_phone(ident)
        if em and u.get("email") == em: rec["email"] = em            # reply on the channel the person typed
        elif ph and u.get("phone") == ph: rec["phone"] = ph
        elif u.get("email"): rec["email"] = u["email"]                # typed a username: email first, then phone
        else: rec["phone"] = u.get("phone", "")
        print(f"[reset] account {name!r} found, sending code to {mask(rec['email'], rec['phone'])}")
        if not deliver_code(rec["email"], rec["phone"], rec["code"], "reset"):
            print(f"[reset] delivery failed for {name}")
            if DEV_CODES:
                out["dev_code"] = rec["code"]
        elif DEV_CODES:
            out["dev_code"] = rec["code"]
    token = secrets.token_urlsafe(16)
    with data_lock:
        for k in [k for k, v in pending_reset.items() if v["exp"] < time.time()]:
            pending_reset.pop(k, None)
        pending_reset[token] = rec
    session["reset_token"] = token
    return jsonify(out)        # same answer whether or not the account exists (no account enumeration)


@app.route("/api/forgot/resend", methods=["POST"])
def forgot_resend():
    rec = pending_reset.get(session.get("reset_token"))
    if not rec or rec["exp"] < time.time():
        return jsonify(error="جلسه منقضی شد؛ از اول شروع کن."), 400
    if time.time() - rec["sent_at"] < 30:
        return jsonify(error="۳۰ ثانیه صبر کن و دوباره تلاش کن."), 429
    rec.update(code=new_code(), exp=time.time() + CODE_TTL, tries=0, sent_at=time.time())
    out = {"ok": True}
    if rec["valid"] and rate_ok("fg-to:" + rec["username"], 4, 600):
        deliver_code(rec["email"], rec["phone"], rec["code"], "reset")
        if DEV_CODES: out["dev_code"] = rec["code"]
    return jsonify(out)


@app.route("/api/forgot/verify", methods=["POST"])
def forgot_verify():
    token = session.get("reset_token")
    rec = pending_reset.get(token)
    p = request.get_json(silent=True) or {}
    code, password = str(p.get("code", "")).translate(DIGITS).strip(), str(p.get("password", ""))
    if not rec or rec["exp"] < time.time():
        return jsonify(error="کد منقضی شده؛ دوباره درخواست بده."), 400
    if len(password) < 8:
        return jsonify(error="رمز جدید باید حداقل ۸ کاراکتر باشد."), 400
    rec["tries"] += 1
    if rec["tries"] > 5:
        pending_reset.pop(token, None)
        return jsonify(error="تعداد تلاش‌ها زیاد بود؛ دوباره درخواست بده."), 429
    if not rec["valid"] or not hmac.compare_digest(rec["code"], code):
        return jsonify(error="کد اشتباه است."), 400
    with data_lock:
        users = read_json(USERS_FILE, {})
        if rec["username"] not in users:
            return jsonify(error="حساب پیدا نشد."), 404
        users[rec["username"]]["password_hash"] = generate_password_hash(password)
        write_json(USERS_FILE, users)
    pending_reset.pop(token, None)
    login_user(rec["username"])
    return sync_user_lang(jsonify(ok=True, redirect=url_for("chat")), rec["username"])


@app.route("/chat")
@logged_in
def chat():
    username = session["username"]
    users = read_json(USERS_FILE, {})
    if username not in users:
        session.clear()
        return redirect(url_for("index"))
    session.permanent = True
    resp = make_response(render_template("chat.html", current_user=safe_user_public(users[username], True),
                                         groups=my_groups(username), users=visible_users(username),
                                         max_file_mb=MAX_FILE_MB))
    return sync_user_lang(resp, username)


@app.route("/logout")
def logout():
    insta_user = session.get("insta_username")      # chat logout must not end the separate Insta session
    session.clear()
    if insta_user:
        session["insta_username"] = insta_user
    return redirect(url_for("index"))


@app.route("/join/<invite_code>")
def join_invite(invite_code):
    if "username" not in session:
        session["pending_invite"] = invite_code
        return redirect(url_for("auth_page", section="chat"))
    session.pop("pending_invite", None)
    username = session["username"]
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        match = next(((gid, g) for gid, g in groups.items()
                      if secrets.compare_digest(str(g.get("invite_code", "")), str(invite_code))), None)
        if not match:
            flash("لینک دعوت معتبر نیست یا منقضی شده است.", "error")
            return redirect(url_for("chat"))
        gid, g = match
        if g.get("type") == "dm":
            return redirect(url_for("chat"))
        if username in g.get("banned", []):
            flash("دسترسی تو به این گروه مسدود شده است.", "error")
            return redirect(url_for("chat"))
        if username not in g.setdefault("members", []):
            g["members"].append(username)
            write_json(GROUPS_FILE, groups)
            socketio.emit("group_updated", {"id": gid, "group": public_group(g)}, to=gid)
            join_sids(username, gid)
            socketio.emit("groups_snapshot", {"groups": my_groups(username)}, to="user:" + username)
    flash("با موفقیت به گروه پیوستی.", "success")
    return redirect(url_for("chat") + "?group=" + gid)


@app.route("/api/profile", methods=["POST"])
@logged_in
def update_profile():
    display_name = str(request.form.get("display_name", "")).strip()[:32]
    bio = str(request.form.get("bio", "")).strip()[:160]
    avatar = str(request.form.get("avatar", "🙂")).strip()[:12]
    if not display_name:
        return jsonify(error="نام نمایشی نمی‌تواند خالی باشد."), 400
    birthday = str(request.form.get("birthday", "")).strip()
    if birthday:
        try:
            bd = datetime.strptime(birthday, "%Y-%m-%d").date()
        except ValueError:
            return jsonify(error="تاریخ تولد معتبر نیست."), 400
        if bd.year < 1900 or bd > datetime.now().date():
            return jsonify(error="تاریخ تولد معتبر نیست."), 400
    username = session["username"]
    old_photo = ""
    with data_lock:
        users = read_json(USERS_FILE, {})
        if username not in users:
            return jsonify(error="کاربر پیدا نشد."), 404
        photo = request.files.get("avatar_photo")
        if photo and photo.filename:
            ext = os.path.splitext(secure_filename(photo.filename))[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                return jsonify(error="فرمت عکس پشتیبانی نمی‌شود."), 400
            photo.stream.seek(0, os.SEEK_END)
            size = photo.stream.tell()
            photo.stream.seek(0)
            if size > MAX_IMAGE_SIZE:
                return jsonify(error="حجم عکس باید کمتر از ۴ مگابایت باشد."), 400
            data = photo.read()
            if not looks_like_image(data[:16]):
                return jsonify(error="فایل تصویر معتبر نیست."), 400
            filename = f"{uuid.uuid4().hex}{ext}"
            store_media(filename, IMAGE_MIME[ext], data)
            old_photo = users[username].get("avatar_url", "")
            users[username]["avatar_url"] = "/media/" + filename
        users[username].update(display_name=display_name, bio=bio, avatar=avatar, birthday=birthday)
        for _k in ("show_phone", "show_email", "show_birthday"):   # only touch a flag if the form really sent it
            if _k in request.form:
                users[username][_k] = request.form.get(_k) == "1"
        users[username].setdefault("avatar_url", "")
        write_json(USERS_FILE, users)
        pub = safe_user_public(users[username])
        full = safe_user_public(users[username], True)
    if old_photo and old_photo != pub["avatar_url"]:
        remove_media_url(old_photo)
    socketio.emit("profile_updated", pub)
    return jsonify(ok=True, user=full)


@app.route("/api/groups", methods=["POST"])
@logged_in
def create_group():
    p = request.get_json(silent=True) or {}
    name = str(p.get("name", "")).strip()[:40]
    desc = str(p.get("description", "")).strip()[:180]
    if not name:
        return jsonify(error="نام گروه را وارد کن."), 400
    username = session["username"]
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        gid = uuid.uuid4().hex[:12]
        groups[gid] = {"name": name, "description": desc, "members": [username], "owner": username,
                       "admins": [], "banned": [], "type": "group", "invite_code": secrets.token_urlsafe(12),
                       "avatar_url": "", "background": "", "pins": [],
                       "only_admins_post": False, "members_can_invite": True}
        write_json(GROUPS_FILE, groups)
    join_sids(username, gid)
    socketio.emit("groups_snapshot", {"groups": my_groups(username)}, to="user:" + username)
    return jsonify(ok=True, id=gid, group=public_group(groups[gid]))


@app.route("/api/group/<group_id>", methods=["POST"])
@logged_in
def update_group(group_id):
    p = request.get_json(silent=True) or {}
    username = session["username"]
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or not is_member(g, username):
            return jsonify(error="گروه پیدا نشد یا عضو آن نیستی."), 404
        if g.get("type") == "dm":
            return jsonify(error="گفتگوی خصوصی تنظیمات ندارد."), 400
        if not is_admin(g, username):
            return jsonify(error="فقط مالک یا ادمین گرو
