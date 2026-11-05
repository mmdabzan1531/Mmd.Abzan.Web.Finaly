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
            return redirect(url_for("index"))
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
    return d


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
    session.clear()
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
               "avatar": "🤖", "avatar_url": "/bot-avatar.webp?v=2"}

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
    "AAAAAAAAAA=="
)


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


@app.route("/", methods=["GET", "POST"])
def index():
    if "username" in session:
        return redirect(url_for("chat"))
    need = session.get("login_fails", 0) >= 3          # captcha only after repeated failures (like big sites)
    if request.method == "GET":
        pick = need_lang_choice()                      # first visit: ask for the language
        if pick:
            return pick
        return render_template("index.html", need_captcha=need, captcha_question=new_captcha() if need else "")
    ident = request.form.get("identifier", "").strip()[:120]
    password = request.form.get("password", "")
    if not rate_ok("login:" + client_ip(), 20, 600):
        flash("تعداد تلاش‌ها زیاد بود؛ چند دقیقه بعد دوباره امتحان کن.", "error")
        return redirect(url_for("index"))
    if need and not captcha_ok(request.form.get("captcha")):
        flash("تأیید ربات ناموفق بود؛ حاصل جمع را درست وارد کن.", "error")
        return redirect(url_for("index"))
    users = read_json(USERS_FILE, {})
    name = find_user(ident, users)
    good = check_password_hash(users[name].get("password_hash", ""), password) if name else (check_password_hash(_DUMMY_HASH, password) and False)
    if not name or not good:
        session["login_fails"] = session.get("login_fails", 0) + 1
        flash("نام کاربری یا رمز عبور درست نیست. دوباره تلاش کن یا رمز را بازیابی کن.", "error")
        return redirect(url_for("index"))
    return start_session(name)


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
    p = request.get_json(silent=True) or {}
    fail = lambda m, c=400: (jsonify(error=m, captcha=new_captcha()), c)
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
    code = str((request.get_json(silent=True) or {}).get("code", "")).translate(DIGITS).strip()
    if not rec or rec["exp"] < time.time():
        return jsonify(error="کد منقضی شده؛ از اول ثبت‌نام کن."), 400
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
    onboard_bot_chat(rec["username"])
    inv = login_user(rec["username"])
    resp = jsonify(ok=True, redirect=url_for("join_invite", invite_code=inv) if inv else url_for("chat"))
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
    session.clear()
    return redirect(url_for("index"))


@app.route("/join/<invite_code>")
def join_invite(invite_code):
    if "username" not in session:
        session["pending_invite"] = invite_code
        return redirect(url_for("index", mode="login"))
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
        users[username].update(display_name=display_name, bio=bio, avatar=avatar,
                               show_phone=request.form.get("show_phone") == "1", show_email=request.form.get("show_email") == "1",
                               birthday=birthday, show_birthday=request.form.get("show_birthday") == "1")
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
            return jsonify(error="فقط مالک یا ادمین گروه می‌تواند تنظیمات را تغییر دهد."), 403
        name = str(p.get("name", "")).strip()[:40]
        desc = str(p.get("description", "")).strip()[:180]
        if not name:
            return jsonify(error="نام گروه نمی‌تواند خالی باشد."), 400
        g.update(name=name, description=desc)
        write_json(GROUPS_FILE, groups)
    socketio.emit("group_updated", {"id": group_id, "group": public_group(g)}, to=group_id)
    return jsonify(ok=True, group=public_group(g))


@app.route("/api/group/<group_id>/invite", methods=["POST"])
@logged_in
def invite_link(group_id):
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or not is_member(g, session["username"]):
            return jsonify(error="به این گروه دسترسی نداری."), 403
        if g.get("type") == "dm":
            return jsonify(error="برای گفتگوی خصوصی لینک دعوت وجود ندارد."), 400
        if not g.get("members_can_invite", True) and not is_admin(g, session["username"]):
            return jsonify(error="فقط مالک یا ادمین می‌تواند لینک دعوت بگیرد."), 403
        if not g.get("invite_code"):
            g["invite_code"] = secrets.token_urlsafe(12)
            write_json(GROUPS_FILE, groups)
    return jsonify(ok=True, invite_url=request.url_root.rstrip("/") + "/join/" + g["invite_code"])


@app.route("/api/user/<username>")
@logged_in
def public_profile(username):
    u = read_json(USERS_FILE, {}).get(username)
    if not u:
        return jsonify(error="کاربر پیدا نشد."), 404
    return jsonify(ok=True, user=safe_user_public(u))


@app.route("/api/dm", methods=["POST"])
@logged_in
def open_dm():
    me = session["username"]
    other = str((request.get_json(silent=True) or {}).get("username", "")).strip()
    users = read_json(USERS_FILE, {})
    if other not in users or other == me:
        return jsonify(error="کاربر پیدا نشد."), 404
    gid = dm_id(me, other)
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        if gid not in groups:
            groups[gid] = {"name": "", "description": "", "members": [me, other], "owner": "", "type": "dm",
                           "created_by": me, "invite_code": secrets.token_urlsafe(12)}
            write_json(GROUPS_FILE, groups)
        d = public_group(groups[gid]); d["last"] = last_msg(gid)
    join_sids(me, gid); join_sids(other, gid)
    return jsonify(ok=True, id=gid, group=d, user=safe_user_public(users[other]))


# ---------- my full profile + contacts (Telegram-style bottom bar) ----------
@app.route("/api/me/profile")
@api_login
def my_full_profile():
    u = read_json(USERS_FILE, {}).get(session["username"])
    if not u:
        return jsonify(error="کاربر پیدا نشد."), 404
    return jsonify(ok=True, user=safe_user_public(u, True))


def _find_user_by_ident(users, ident):
    """username (with/without @) or phone number -> username or None."""
    ident = str(ident or "").strip()
    if not ident:
        return None
    low = ident.lstrip("@").lower()
    for n in users:
        if n.lower() == low:
            return n
    ph = norm_phone(ident)
    if ph:
        for n, u in users.items():
            if u.get("phone") and u.get("phone") == ph:
                return n
    return None


def _contacts_payload(users, me):
    saved = users.get(me, {}).get("contacts") or {}
    out = []
    for name, custom in saved.items():
        if name in users and name != me:
            out.append({"username": name, "name": str(custom or "")[:60], "user": safe_user_public(users[name])})
    out.sort(key=lambda c: (c["name"] or c["user"]["display_name"] or c["username"]).lower())
    return out


@app.route("/api/privacy", methods=["POST"])
@api_login
def api_privacy():
    d = request.get_json(silent=True) or {}
    keys = ("show_online", "show_phone", "show_email", "show_bio", "show_birthday")
    with data_lock:
        users = read_json(USERS_FILE, {})
        me = session["username"]
        if me not in users:
            return jsonify(error="کاربر پیدا نشد."), 404
        for k in keys:
            if k in d:
                users[me][k] = bool(d[k])
        write_json(USERS_FILE, users)
        pub, full = safe_user_public(users[me]), safe_user_public(users[me], True)
    socketio.emit("profile_updated", pub)
    broadcast_presence()
    return jsonify(ok=True, user=full)


# ---------- premium purchase (Zarinpal) ----------
# Set these environment variables on the server (Render -> Environment):
#   ZARINPAL_MERCHANT_ID   your 36-character merchant id   (required, otherwise buying is disabled)
#   PREMIUM_PRICE_TOMAN    price in Toman           (default 50000)
#   PREMIUM_DAYS           length of one purchase    (default 30)
#   ZARINPAL_SANDBOX=1     use the test gateway while trying it out
PAYMENTS_FILE = os.path.join(DATA_DIR, "payments.json")


def premium_plan():
    def _int(name, default):
        try:
            return max(1, int(env(name, str(default)) or default))
        except (TypeError, ValueError):
            return default
    return {"price": _int("PREMIUM_PRICE_TOMAN", 50000), "days": _int("PREMIUM_DAYS", 30),
            "merchant": env("ZARINPAL_MERCHANT_ID").strip(),
            "sandbox": env("ZARINPAL_SANDBOX").strip().lower() in ("1", "true", "yes")}


def _zp_call(plan, path, payload):
    base = "https://sandbox.zarinpal.com" if plan["sandbox"] else "https://payment.zarinpal.com"
    req = urllib.request.Request(base + path, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "ChatRoom"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode("utf-8") or "{}"
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace") or "{}"
    return json.loads(body)


@app.route("/api/premium")
@logged_in
def premium_info():
    users = read_json(USERS_FILE, {})
    u = users.get(session["username"]) or {}
    plan = premium_plan()
    until = 0
    try:
        until = float(u.get("premium_until") or 0)
    except (TypeError, ValueError):
        pass
    return jsonify(ok=True, price=plan["price"], days=plan["days"], configured=bool(plan["merchant"]),
                   premium=is_premium(u), until=until)


@app.route("/api/premium/buy", methods=["POST"])
@logged_in
def premium_buy():
    plan = premium_plan(); me = session["username"]
    if not plan["merchant"]:
        return jsonify(error="درگاه پرداخت هنوز فعال نشده است. با پشتیبانی در ارتباط باش.", code="not_configured"), 503
    users = read_json(USERS_FILE, {})
    u = users.get(me) or {}
    meta = {}
    if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", str(u.get("email") or "")):
        meta["email"] = u["email"]
    payload = {"merchant_id": plan["merchant"], "amount": plan["price"] * 10,       # the gateway counts in Rial
               "callback_url": url_for("premium_callback", _external=True),
               "description": f"خرید اشتراک پریمیوم ChatRoom ({plan['days']} روزه) - {me}", "metadata": meta}
    try:
        res = _zp_call(plan, "/pg/v4/payment/request.json", payload)
    except Exception:
        return jsonify(error="اتصال به درگاه پرداخت برقرار نشد. کمی بعد دوباره تلاش کن."), 502
    data = res.get("data") if isinstance(res.get("data"), dict) else {}
    authority = data.get("authority")
    if data.get("code") != 100 or not authority:
        return jsonify(error="درگاه پرداخت درخواست را نپذیرفت. لطفاً بعداً تلاش کن."), 502
    with data_lock:
        pay = read_json(PAYMENTS_FILE, {})
        pay[authority] = {"user": me, "amount": plan["price"], "days": plan["days"], "status": "pending", "created_at": time.time()}
        write_json(PAYMENTS_FILE, pay)
    base = "https://sandbox.zarinpal.com" if plan["sandbox"] else "https://payment.zarinpal.com"
    return jsonify(ok=True, url=f"{base}/pg/StartPay/{authority}")


@app.route("/premium/callback")
def premium_callback():
    authority = request.args.get("Authority", "")
    ok_status = request.args.get("Status", "") == "OK"
    plan = premium_plan()
    with data_lock:
        pay = read_json(PAYMENTS_FILE, {})
        rec = pay.get(authority)
        if not rec:
            return redirect("/chat?premium=unknown")
        if rec.get("status") == "paid":
            return redirect("/chat?premium=ok")
        if not ok_status:
            rec["status"] = "canceled"; write_json(PAYMENTS_FILE, pay)
            return redirect("/chat?premium=cancel")
        try:
            res = _zp_call(plan, "/pg/v4/payment/verify.json", {"merchant_id": plan["merchant"], "amount": rec["amount"] * 10, "authority": authority})
        except Exception:
            return redirect("/chat?premium=error")        # nothing is granted; the user can retry / contact support
        data = res.get("data") if isinstance(res.get("data"), dict) else {}
        if data.get("code") not in (100, 101):
            rec["status"] = "failed"; write_json(PAYMENTS_FILE, pay)
            return redirect("/chat?premium=failed")
        users = read_json(USERS_FILE, {})
        u = users.get(rec["user"])
        if u is not None:
            try:
                start = max(time.time(), float(u.get("premium_until") or 0))
            except (TypeError, ValueError):
                start = time.time()
            u["premium_until"] = start + int(rec.get("days") or plan["days"]) * 86400
            write_json(USERS_FILE, users)
        rec.update(status="paid", ref_id=data.get("ref_id"), paid_at=time.time())
        write_json(PAYMENTS_FILE, pay)
    return redirect("/chat?premium=ok")


# ---------- stories (24 h free; 48 h / 72 h need premium) ----------
STORIES_FILE = os.path.join(DATA_DIR, "stories.json")
STORY_BGS = {f"g{i}" for i in range(1, 13)}
STORY_HOURS_FREE = (6, 12, 24)
STORY_HOURS_PREMIUM = (48, 72)
MAX_ACTIVE_STORIES = 30


def is_premium(u):
    """Premium = users.json has \"premium\": true (or \"premium_until\": <unix time>), or the name is in CHATROOM_PREMIUM_USERS=a,b,c."""
    if not u:
        return False
    if u.get("premium") is True:
        return True
    try:
        if u.get("premium_until") and float(u["premium_until"]) > time.time():
            return True
    except (TypeError, ValueError):
        pass
    names = {x.strip().lower() for x in env("CHATROOM_PREMIUM_USERS").split(",") if x.strip()}
    return str(u.get("username", "")).lower() in names


def _story_out(s, me):
    out = {k: s.get(k) for k in ("id", "user", "kind", "media_url", "text", "caption", "bg", "created_at", "expires_at", "duration_h", "audience")}
    out["viewed"] = me in (s.get("views") or {})
    if s["user"] == me:
        out.update(views_count=len(s.get("views") or {}), in_profile=bool(s.get("in_profile", True)),
                   archived=bool(s.get("archived")), active=s["expires_at"] > time.time())
    return out


def _stories_cleanup(items):
    """Expired stories that were not saved to the profile are removed (with their photo)."""
    now = time.time()
    dead = [i for i, st in items.items() if st["expires_at"] <= now and not st.get("in_profile", True)]
    for i in dead:
        remove_media_url(items.pop(i).get("media_url"))
    return bool(dead)


def _story_circle(me, users):
    """Usernames whose stories I may see: people I share a chat with + my contacts + people who saved me."""
    names = set()
    for g in read_json(GROUPS_FILE, {}).values():
        if me in g.get("members", []):
            names.update(g.get("members", []))
    names.update((users.get(me, {}).get("contacts") or {}).keys())
    names.update(n for n, u in users.items() if isinstance(u.get("contacts"), dict) and me in u["contacts"])
    names.discard(me)
    return names


def _can_see_story(st, me, users, circle):
    if st["user"] == me:
        return True
    if st["user"] not in users:
        return False
    if st.get("audience") == "contacts":      # "contacts only": people in my circle who are in my contacts
        return st["user"] in circle and me in (users[st["user"]].get("contacts") or {})
    return True                               # "everyone": every signed-in user sees it


@app.route("/api/stories", methods=["GET", "POST"])
@api_login
def api_stories():
    me = session["username"]
    if request.method == "GET":
        with data_lock:
            items = read_json(STORIES_FILE, {})
            if _stories_cleanup(items):
                write_json(STORIES_FILE, items)
        users, now = read_json(USERS_FILE, {}), time.time()
        circle = _story_circle(me, users)
        by_user = {}
        for st in items.values():
            if st["expires_at"] > now and _can_see_story(st, me, users, circle):
                by_user.setdefault(st["user"], []).append(st)
        res = []
        for n, lst in by_user.items():
            lst.sort(key=lambda x: x["created_at"])
            res.append({"user": safe_user_public(users[n]), "stories": [_story_out(x, me) for x in lst],
                        "unseen": any(me not in (x.get("views") or {}) for x in lst) and n != me, "latest": lst[-1]["created_at"]})
        res.sort(key=lambda g: (g["user"]["username"] != me, not g["unseen"], -g["latest"]))
        return jsonify(ok=True, groups=res)

    # ---- create ----
    f = request.form
    kind = f.get("kind", "image")
    if kind not in ("image", "text", "video"):
        return jsonify(error="نوع استوری نامعتبر است."), 400
    try:
        hours = int(f.get("duration", "24"))
    except ValueError:
        hours = 24
    if hours not in STORY_HOURS_FREE + STORY_HOURS_PREMIUM:
        return jsonify(error="مدت نمایش نامعتبر است."), 400
    audience = "contacts" if f.get("audience") == "contacts" else "everyone"
    text = str(f.get("text", "")).strip()[:300]
    caption = str(f.get("caption", "")).strip()[:200]
    bg = f.get("bg", "g1") if f.get("bg", "g1") in STORY_BGS else "g1"
    media_url, data, ext = "", None, ""
    if kind == "text":
        if not text:
            return jsonify(error="متن استوری را بنویس."), 400
        caption = ""
    elif kind == "video":
        clip = request.files.get("image") or request.files.get("video")
        if not clip or not clip.filename:
            return jsonify(error="یک ویدیو انتخاب کن."), 400
        ext = os.path.splitext(secure_filename(clip.filename))[1].lower()
        if ext not in VIDEO_MIME:
            return jsonify(error="فرمت ویدیو پشتیبانی نمی‌شود (mp4 / webm / mov)."), 400
        data = clip.read(MAX_FILE_SIZE + 1)
        if len(data) > MAX_FILE_SIZE:
            return jsonify(error=f"حجم ویدیو باید کمتر از {MAX_FILE_MB} مگابایت باشد."), 400
        if not data:
            return jsonify(error="فایل خالی است."), 400
        text = ""
    else:
        photo = request.files.get("image")
        if not photo or not photo.filename:
            return jsonify(error="یک عکس انتخاب کن."), 400
        ext = os.path.splitext(secure_filename(photo.filename))[1].lower()
        if ext not in ALLOWED_IMAGE_EXTENSIONS:
            return jsonify(error="فرمت عکس پشتیبانی نمی‌شود."), 400
        data = photo.read(MAX_IMAGE_SIZE + 1)
        if len(data) > MAX_IMAGE_SIZE:
            return jsonify(error="حجم عکس باید کمتر از ۴ مگابایت باشد."), 400
        if not looks_like_image(data[:16]):
            return jsonify(error="فایل تصویر معتبر نیست."), 400
        text = ""
    with data_lock:
        users = read_json(USERS_FILE, {})
        if me not in users:
            return jsonify(error="کاربر پیدا نشد."), 404
        if hours in STORY_HOURS_PREMIUM and not is_premium(users[me]):
            return jsonify(error="نمایش ۴۸ و ۷۲ ساعته فقط برای کاربران پریمیوم است.", code="premium_required"), 403
        items = read_json(STORIES_FILE, {})
        _stories_cleanup(items)
        now = time.time()
        if sum(1 for x in items.values() if x["user"] == me and x["expires_at"] > now) >= MAX_ACTIVE_STORIES:
            return jsonify(error="تعداد استوری‌های فعالت به سقف رسیده است."), 400
        if data is not None:
            filename = f"{uuid.uuid4().hex}{ext}"
            store_media(filename, (VIDEO_MIME if kind == "video" else IMAGE_MIME)[ext], data)
            media_url = "/media/" + filename
        sid = uuid.uuid4().hex[:16]
        items[sid] = {"id": sid, "user": me, "kind": kind, "media_url": media_url, "text": text, "caption": caption, "bg": bg,
                      "created_at": now, "expires_at": now + hours * 3600, "duration_h": hours, "audience": audience,
                      "in_profile": f.get("save_profile", "1") == "1", "archived": False, "views": {}}
        write_json(STORIES_FILE, items)
        out = _story_out(items[sid], me)
    socketio.emit("stories_changed", {"user": me})     # everybody's story row refreshes right away
    return jsonify(ok=True, story=out)


@app.route("/api/stories/mine")
@api_login
def api_stories_mine():
    me = session["username"]
    with data_lock:
        items = read_json(STORIES_FILE, {})
        if _stories_cleanup(items):
            write_json(STORIES_FILE, items)
    mine = sorted((x for x in items.values() if x["user"] == me), key=lambda x: -x["created_at"])
    return jsonify(ok=True, stories=[_story_out(x, me) for x in mine])


@app.route("/api/stories/<sid>/view", methods=["POST"])
@api_login
def api_story_view(sid):
    me = session["username"]
    with data_lock:
        items = read_json(STORIES_FILE, {})
        st = items.get(sid)
        users = read_json(USERS_FILE, {})
        if not st or st["expires_at"] <= time.time() or not _can_see_story(st, me, users, _story_circle(me, users)):
            return jsonify(error="استوری پیدا نشد."), 404
        if st["user"] != me and me not in (st.get("views") or {}):
            st.setdefault("views", {})[me] = time.time()
            write_json(STORIES_FILE, items)
    return jsonify(ok=True)


@app.route("/api/stories/<sid>/views")
@api_login
def api_story_views(sid):
    me = session["username"]
    st = read_json(STORIES_FILE, {}).get(sid)
    if not st or st["user"] != me:
        return jsonify(error="استوری پیدا نشد."), 404
    users = read_json(USERS_FILE, {})
    rows = sorted(((n, ts) for n, ts in (st.get("views") or {}).items() if n in users), key=lambda r: -r[1])
    return jsonify(ok=True, views=[{"user": safe_user_public(users[n]), "at": ts} for n, ts in rows])


@app.route("/api/stories/<sid>/archive", methods=["POST"])
@api_login
def api_story_archive(sid):
    me = session["username"]
    flag = bool((request.get_json(silent=True) or {}).get("archived"))
    with data_lock:
        items = read_json(STORIES_FILE, {})
        st = items.get(sid)
        if not st or st["user"] != me:
            return jsonify(error="استوری پیدا نشد."), 404
        st["archived"] = flag
        write_json(STORIES_FILE, items)
    return jsonify(ok=True, archived=flag)


@app.route("/api/stories/<sid>", methods=["DELETE"])
@api_login
def api_story_delete(sid):
    me = session["username"]
    with data_lock:
        items = read_json(STORIES_FILE, {})
        st = items.get(sid)
        if not st or st["user"] != me:
            return jsonify(error="استوری پیدا نشد."), 404
        items.pop(sid)
        write_json(STORIES_FILE, items)
    remove_media_url(st.get("media_url"))
    socketio.emit("stories_changed", {"user": me})
    return jsonify(ok=True)


@app.route("/api/contacts", methods=["GET", "POST"])
@api_login
def api_contacts():
    me = session["username"]
    if request.method == "GET":
        return jsonify(ok=True, contacts=_contacts_payload(read_json(USERS_FILE, {}), me))
    d = request.get_json(silent=True) or {}
    custom = str(d.get("name", "")).strip()[:60]
    with data_lock:
        users = read_json(USERS_FILE, {})
        if me not in users:
            return jsonify(error="کاربر پیدا نشد."), 404
        other = _find_user_by_ident(users, d.get("ident"))
        if not other or other == me or other == BOT_USER:
            return jsonify(error="کاربری با این نام کاربری یا شماره پیدا نشد."), 404
        contacts = users[me].get("contacts")
        if not isinstance(contacts, dict):
            contacts = {}
        if len(contacts) >= 2000 and other not in contacts:
            return jsonify(error="سقف تعداد مخاطبین پر شده است."), 400
        contacts[other] = custom
        users[me]["contacts"] = contacts
        write_json(USERS_FILE, users)
        res = _contacts_payload(users, me)
    return jsonify(ok=True, contacts=res, added=other)


@app.route("/api/contacts/<username>", methods=["DELETE"])
@api_login
def api_contact_delete(username):
    me = session["username"]
    with data_lock:
        users = read_json(USERS_FILE, {})
        contacts = (users.get(me) or {}).get("contacts")
        if isinstance(contacts, dict) and username in contacts:
            del contacts[username]
            users[me]["contacts"] = contacts
            write_json(USERS_FILE, users)
        res = _contacts_payload(users, me)
    return jsonify(ok=True, contacts=res)


@app.route("/api/contacts/match", methods=["POST"])
@api_login
def api_contacts_match():
    """The phone's address book (picked by the user in the browser) -> which numbers are registered here.
    Phone numbers are only compared, never stored. Matches are saved as contacts under the phone-book name."""
    me = session["username"]
    items = (request.get_json(silent=True) or {}).get("items")
    if not isinstance(items, list):
        return jsonify(error="درخواست نامعتبر است."), 400
    wanted = {}
    for it in items[:600]:
        if not isinstance(it, dict):
            continue
        nm = str(it.get("name", "")).strip()[:60]
        for p in (it.get("phones") or [])[:5]:
            ph = norm_phone(p)
            if ph and ph not in wanted:
                wanted[ph] = nm
    with data_lock:
        users = read_json(USERS_FILE, {})
        if me not in users:
            return jsonify(error="کاربر پیدا نشد."), 404
        by_phone = {u.get("phone"): n for n, u in users.items() if u.get("phone") and n not in (me, BOT_USER)}
        contacts = users[me].get("contacts")
        if not isinstance(contacts, dict):
            contacts = {}
        found = 0
        for ph, nm in wanted.items():
            n = by_phone.get(ph)
            if n:
                found += 1
                if len(contacts) < 2000 or n in contacts:
                    contacts[n] = nm or contacts.get(n, "")
        users[me]["contacts"] = contacts
        write_json(USERS_FILE, users)
        res = _contacts_payload(users, me)
    return jsonify(ok=True, contacts=res, found=found, total=len(wanted))


@app.route("/api/users/search")
@logged_in
def search_users():
    s = request.args.get("q", "").strip().lower().lstrip("@")
    if len(s) < 2:
        return jsonify(ok=True, users=[])
    me = session["username"]
    res = [safe_user_public(u) for n, u in read_json(USERS_FILE, {}).items()
           if n != me and (s in n.lower() or s in u.get("display_name", "").lower())]
    return jsonify(ok=True, users=res[:15])


@app.context_processor
def inject_site():
    n = datetime.now()
    y = n.year - 621 if (n.month, n.day) >= (3, 21) else n.year - 622
    return {"SITE": {"email": env("SUPPORT_EMAIL", "support@chatroom.example"), "phone": env("SUPPORT_PHONE", "۰۹۱۲۰۰۰۰۰۰۰"),
                     "tel": env("SUPPORT_TEL", "۰۲۱-۹۱۰۰۰۰۰۰"), "address": env("SUPPORT_ADDRESS", "تهران، خیابان نمونه، پلاک ۱۰ (اطلاعات آزمایشی)"),
                     "year": str(y).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))},
            "LANG": current_lang(), "LANGS": LANGS}


@app.route("/privacy")
@app.route("/terms")
def legal():
    return render_template("legal.html", kind="privacy" if request.path == "/privacy" else "terms", logged="username" in session)


@app.route("/contact")
def contact():
    return redirect("/about#contact")


@app.route("/about")
@app.route("/support")
def about():
    return render_template("about.html", logged="username" in session)


@app.route("/api/support", methods=["POST"])
def support_submit():
    p = request.get_json(silent=True) or {}
    dq, now = recent_sends["support:" + (request.remote_addr or "?")], time.time()
    while dq and now - dq[0] > 600:
        dq.popleft()
    if len(dq) >= 3:
        return jsonify(error="تعداد درخواست‌ها زیاد است؛ کمی بعد تلاش کن."), 429
    msg = str(p.get("message", "")).strip()[:1500]
    if len(msg) < 5:
        return jsonify(error="پیامت را کامل‌تر بنویس."), 400
    dq.append(now)
    with data_lock:
        items = read_json(SUPPORT_FILE, [])
        ticket = f"CR-{len(items) + 1001}"
        items.append({"ticket": ticket, "user": session.get("username", ""), "contact": str(p.get("contact", ""))[:120],
                      "subject": str(p.get("subject", ""))[:80], "message": msg, "at": datetime.now(timezone.utc).isoformat()})
        write_json(SUPPORT_FILE, items)
    return jsonify(ok=True, ticket=ticket)


# ---------- group roles: owner > admin > member ----------
def role_of(g, username):
    if g.get("type") == "dm":
        return "member" if username in g.get("members", []) else None
    if g.get("owner") == username:
        return "owner"
    if username in g.get("admins", []):
        return "admin"
    return "member" if username in g.get("members", []) else None


def is_admin(g, username):
    return g.get("type") != "dm" and role_of(g, username) in ("owner", "admin")


def _err(msg, code=400):
    return jsonify(error=msg), code


def _kick_sids(username, gid):
    for sid, u in list(online_sids.items()):
        if u == username:
            socketio.server.leave_room(sid, gid, namespace="/")


def _refresh_user(username):
    socketio.emit("groups_snapshot", {"groups": my_groups(username)}, to="user:" + username)


def _group_updated(gid, g):
    socketio.emit("group_updated", {"id": gid, "group": public_group(g)}, to=gid)


@app.route("/api/group/<group_id>/members")
@api_login
def group_members(group_id):
    me = session["username"]
    g = valid_group(me, group_id)
    if not g:
        return _err("گروه پیدا نشد.", 404)
    users = read_json(USERS_FILE, {})
    out = []
    for n in g["members"]:
        if n in users:
            d = safe_user_public(users[n])
            d["role"] = role_of(g, n)
            out.append(d)
    order = {"owner": 0, "admin": 1, "member": 2}
    out.sort(key=lambda d: order.get(d["role"], 3))
    return jsonify(ok=True, members=out, my_role=role_of(g, me),
                   banned=g.get("banned", []) if is_admin(g, me) else [])


@app.route("/api/group/<group_id>/kick", methods=["POST"])
@api_login
def group_kick(group_id):
    """مالک/ادمین: حذف عضو. ادمین فقط عضو عادی را می‌تواند حذف کند. body: {username, ban: true}"""
    me = session["username"]
    p = request.get_json(silent=True) or {}
    target = str(p.get("username", ""))
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or not is_admin(g, me):
            return _err("فقط مالک یا ادمین می‌تواند عضو حذف کند.", 403)
        if target == me:
            return _err("برای خروج از گروه از گزینه‌ی «ترک گروه» استفاده کن.")
        if target not in g["members"]:
            return _err("این کاربر عضو گروه نیست.", 404)
        if target == g.get("owner"):
            return _err("مالک گروه را نمی‌شود حذف کرد.", 403)
        if target in g.get("admins", []) and role_of(g, me) != "owner":
            return _err("فقط مالک می‌تواند ادمین را حذف کند.", 403)
        g["members"].remove(target)
        if target in g.get("admins", []):
            g["admins"].remove(target)
        if bool(p.get("ban", True)) and target not in g.setdefault("banned", []):
            g["banned"].append(target)       # با لینک دعوت هم نمی‌تواند برگردد
        write_json(GROUPS_FILE, groups)
    _kick_sids(target, group_id)
    socketio.emit("removed_from_group", {"id": group_id}, to="user:" + target)
    _refresh_user(target)
    _group_updated(group_id, g)
    return jsonify(ok=True, group=public_group(g))


@app.route("/api/group/<group_id>/unban", methods=["POST"])
@api_login
def group_unban(group_id):
    me = session["username"]
    target = str((request.get_json(silent=True) or {}).get("username", ""))
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or not is_admin(g, me):
            return _err("اجازه نداری.", 403)
        if target in g.get("banned", []):
            g["banned"].remove(target)
            write_json(GROUPS_FILE, groups)
    return jsonify(ok=True)


@app.route("/api/group/<group_id>/role", methods=["POST"])
@api_login
def group_role(group_id):
    """فقط مالک: ارتقا به ادمین یا برگشت به عضو عادی. body: {username, role: 'admin'|'member'}"""
    me = session["username"]
    p = request.get_json(silent=True) or {}
    target, role = str(p.get("username", "")), str(p.get("role", ""))
    if role not in ("admin", "member"):
        return _err("نقش نامعتبر است.")
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or role_of(g, me) != "owner":
            return _err("فقط مالک گروه می‌تواند ادمین تعیین کند.", 403)
        if target not in g["members"] or target == me:
            return _err("کاربر معتبر نیست.", 404)
        admins = g.setdefault("admins", [])
        if role == "admin" and target not in admins:
            admins.append(target)
        elif role == "member" and target in admins:
            admins.remove(target)
        write_json(GROUPS_FILE, groups)
    _group_updated(group_id, g)
    _refresh_user(target)
    return jsonify(ok=True, group=public_group(g))


@app.route("/api/group/<group_id>/transfer", methods=["POST"])
@api_login
def group_transfer(group_id):
    """فقط مالک: انتقال مالکیت. مالک قبلی ادمین می‌شود."""
    me = session["username"]
    target = str((request.get_json(silent=True) or {}).get("username", ""))
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or role_of(g, me) != "owner":
            return _err("فقط مالک گروه می‌تواند مالکیت را منتقل کند.", 403)
        if target not in g["members"] or target == me:
            return _err("کاربر معتبر نیست.", 404)
        g["owner"] = target
        admins = g.setdefault("admins", [])
        if target in admins:
            admins.remove(target)
        if me not in admins:
            admins.append(me)
        write_json(GROUPS_FILE, groups)
    _group_updated(group_id, g)
    _refresh_user(me)
    _refresh_user(target)
    return jsonify(ok=True, group=public_group(g))


@app.route("/api/group/<group_id>/photo", methods=["POST"])
@api_login
def group_photo(group_id):
    """مالک/ادمین: تغییر یا حذف عکس گروه. multipart form: photo (فایل) یا remove=1"""
    me = session["username"]
    photo = request.files.get("photo")
    remove = request.form.get("remove") == "1"
    old = ""
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or g.get("type") == "dm" or not is_admin(g, me):
            return _err("فقط مالک یا ادمین می‌تواند عکس گروه را تغییر دهد.", 403)
        old = g.get("avatar_url", "")
        if remove:
            g["avatar_url"] = ""
        elif photo and photo.filename:
            ext = os.path.splitext(secure_filename(photo.filename))[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                return _err("فرمت عکس پشتیبانی نمی‌شود.")
            data = photo.read(MAX_IMAGE_SIZE + 1)
            if len(data) > MAX_IMAGE_SIZE:
                return _err("حجم عکس باید کمتر از ۴ مگابایت باشد.")
            if not data or not looks_like_image(data[:16]):
                return _err("فایل تصویر معتبر نیست.")
            name = uuid.uuid4().hex + ext
            store_media(name, IMAGE_MIME[ext], data)
            g["avatar_url"] = "/media/" + name
        else:
            return _err("عکسی انتخاب نشده است.")
        write_json(GROUPS_FILE, groups)
    if old and old != g.get("avatar_url", ""):
        remove_media_url(old)
    _group_updated(group_id, g)
    for n in list(g.get("members", [])):
        _refresh_user(n)
    return jsonify(ok=True, group=public_group(g))


BG_PRESET_RE = re.compile(r"^[a-z0-9_-]{1,24}$")


@app.route("/api/group/<group_id>/background", methods=["POST"])
@api_login
def group_background(group_id):
    """مالک/ادمین: تغییر پس‌زمینه‌ی چت گروه برای همه‌ی اعضا.
    multipart/form: photo (فایل) | preset=<id> | remove=1"""
    me = session["username"]
    photo = request.files.get("photo")
    preset = str(request.form.get("preset", "")).strip().lower()
    remove = request.form.get("remove") == "1"
    old = ""
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or g.get("type") == "dm" or not is_admin(g, me):
            return _err("فقط مالک یا ادمین می‌تواند پس‌زمینه‌ی گروه را تغییر دهد.", 403)
        old = g.get("background", "")
        if remove:
            g["background"] = ""
        elif preset:
            if not BG_PRESET_RE.fullmatch(preset):
                return _err("پس‌زمینه نامعتبر است.")
            g["background"] = "p:" + preset
        elif photo and photo.filename:
            ext = os.path.splitext(secure_filename(photo.filename))[1].lower()
            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                return _err("فرمت عکس پشتیبانی نمی‌شود.")
            data = photo.read(MAX_IMAGE_SIZE + 1)
            if len(data) > MAX_IMAGE_SIZE:
                return _err("حجم عکس باید کمتر از ۴ مگابایت باشد.")
            if not data or not looks_like_image(data[:16]):
                return _err("فایل تصویر معتبر نیست.")
            name = uuid.uuid4().hex + ext
            store_media(name, IMAGE_MIME[ext], data)
            g["background"] = "/media/" + name
        else:
            return _err("پس‌زمینه‌ای انتخاب نشده است.")
        write_json(GROUPS_FILE, groups)
    if old and old != g.get("background", ""):
        remove_media_url(old)
    _group_updated(group_id, g)
    return jsonify(ok=True, group=public_group(g))


def _delete_group_data(group_id, avatar_url="", background=""):
    names = [a.get("file") for a in (_parse_attach(r["attach"]) for r in
             q("SELECT attach FROM messages WHERE group_id=? AND attach<>''", (group_id,))) if a]
    q("DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE group_id=?)", (group_id,), commit=True)
    q("DELETE FROM poll_votes WHERE message_id IN (SELECT id FROM messages WHERE group_id=?)", (group_id,), commit=True)
    q("DELETE FROM messages WHERE group_id=?", (group_id,), commit=True)
    cleanup_media(names)
    remove_media_url(avatar_url)
    remove_media_url(background)


@app.route("/api/group/<group_id>/leave", methods=["POST"])
@api_login
def group_leave(group_id):
    me = session["username"]
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or me not in g.get("members", []) or g.get("type") == "dm":
            return _err("گروه پیدا نشد.", 404)
        if g.get("owner") == me and len(g["members"]) > 1:
            return _err("مالک نمی‌تواند خارج شود؛ اول مالکیت را منتقل کن یا گروه را حذف کن.", 403)
        if len(g["members"]) <= 1:               # آخرین نفر: گروه پاک می‌شود
            groups.pop(group_id, None)
            write_json(GROUPS_FILE, groups)
            _delete_group_data(group_id, g.get("avatar_url", ""), g.get("background", ""))
            _kick_sids(me, group_id)
            _refresh_user(me)
            return jsonify(ok=True, deleted=True)
        g["members"].remove(me)
        if me in g.get("admins", []):
            g["admins"].remove(me)
        write_json(GROUPS_FILE, groups)
    _kick_sids(me, group_id)
    _refresh_user(me)
    _group_updated(group_id, g)
    return jsonify(ok=True)


@app.route("/api/group/<group_id>/delete", methods=["POST"])
@api_login
def group_delete(group_id):
    """فقط مالک: حذف کامل گروه و همه‌ی پیام‌ها و فایل‌هایش."""
    me = session["username"]
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or g.get("type") == "dm" or role_of(g, me) != "owner":
            return _err("فقط مالک گروه می‌تواند آن را حذف کند.", 403)
        members = list(g["members"])
        groups.pop(group_id)
        write_json(GROUPS_FILE, groups)
        _delete_group_data(group_id, g.get("avatar_url", ""), g.get("background", ""))
    socketio.emit("group_deleted", {"id": group_id}, to=group_id)
    for n in members:
        _kick_sids(n, group_id)
        _refresh_user(n)
    return jsonify(ok=True)


@app.route("/api/group/<group_id>/invite/reset", methods=["POST"])
@api_login
def group_invite_reset(group_id):
    """مالک/ادمین: لینک دعوت قبلی باطل و لینک جدید ساخته می‌شود."""
    me = session["username"]
    with data_lock:
        groups = read_json(GROUPS_FILE, {})
        g = groups.get(group_id)
        if not g or not is_admin(g, me):
            return _err("اجازه نداری.", 403)
        g["invite_code"] = secrets.token_urlsafe(12)
        write_json(GROUPS_FILE, groups)
    return jsonify(ok=True, invite_url=request.url_root.rstrip("/") + "/join/" + g["invite_code"])


# ---------- realtime ----------
def valid_group(username, gid):
    g = read_json(GROUPS_FILE, {}).get(gid)
    return g if g and is_member(g, username) else None


@socketio.on("connect")
def on_connect(auth=None):
    username = session.get("username")
    if not username or username not in read_json(USERS_FILE, {}):
        return False
    online_sids[request.sid] = username
    join_room("user:" + username)
    try:
        onboard_bot_chat(username)          # هر حساب (حتی قدیمی) چت خصوصی با دستیار را دارد
    except Exception as e:
        print("[bot] onboarding failed:", repr(e))
    groups = my_groups(username)
    for gid in groups:
        join_room(gid)
    emit("groups_snapshot", {"groups": groups})
    broadcast_presence()


@socketio.on("disconnect")
def on_disconnect():
    online_sids.pop(request.sid, None)
    recent_sends.pop(request.sid, None)
    broadcast_presence()


@socketio.on("sync")
def on_sync(data):
    username = session.get("username")
    if not username:
        return
    last_read = (data or {}).get("last_read") or {}
    asked = [(gid, last_read[gid]) for gid in my_groups(username) if isinstance(last_read.get(gid), int)]
    counts = {gid: 0 for gid, _ in asked}
    if asked:
        rows = q("SELECT group_id, COUNT(*) c FROM messages WHERE username!=? AND (" + " OR ".join(["(group_id=? AND seq>?)"] * len(asked))
                 + ") GROUP BY group_id", (username,) + tuple(v for pair in asked for v in pair))
        counts.update({r["group_id"]: r["c"] for r in rows})
    emit("unread", {"counts": counts})


@socketio.on("select_group")
def on_select_group(data):
    username = session.get("username")
    gid = str((data or {}).get("group_id", "general"))
    g = valid_group(username, gid) if username else None
    if not g:
        return
    join_room(gid)
    msgs, more = fetch_page(gid)
    emit("group_history", {"group_id": gid, "messages": msgs, "has_more": more, "group": public_group(g)})


@socketio.on("load_older")
def on_load_older(data):
    username = session.get("username")
    data = data or {}
    gid = str(data.get("group_id", ""))
    before = data.get("before")
    if not username or not valid_group(username, gid) or not isinstance(before, int):
        return
    msgs, more = fetch_page(gid, before=before)
    emit("older_messages", {"group_id": gid, "messages": msgs, "has_more": more})


sent_cids = {}   # (username, client id) -> (message, time): makes retries idempotent (no duplicate messages)


def deliver_message(username, gid, text, reply_to="", cid="", attach=None, forwarded_from=""):
    """Single code path for sending (Socket.IO, HTTP fallback and file upload). Returns (message, error)."""
    text, cid = str(text or "").strip()[:1000], str(cid or "")[:40]
    g = valid_group(username, gid) if username else None
    if not g or (not text and not attach):
        return None, "ارسال پیام ممکن نیست."
    if g.get("type") != "dm" and g.get("only_admins_post") and not is_admin(g, username) and username != BOT_USER:
        return None, "در این گروه فقط مالک و ادمین‌ها می‌توانند پیام بفرستند."
    if text:
        text, serr = normalize_special(text)
        if serr:
            return None, serr
    hit = sent_cids.get((username, cid)) if cid else None
    if hit:
        return hit[0], ""
    if not rate_ok("send:" + username, 20, 10):
        return None, "کمی آهسته‌تر؛ پیام‌ها پشت‌سرهم ارسال می‌شوند."
    reply_to = str(reply_to or "")[:50]
    if reply_to and not q("SELECT 1 FROM messages WHERE id=? AND group_id=?", (reply_to, gid), one=True):
        reply_to = ""
    m = insert_message(gid, username, text, reply_to=reply_to, forwarded_from=forwarded_from, attach=attach or "")
    m["cid"] = cid
    if cid:
        now = time.time()
        if len(sent_cids) > 3000:
            for k in [k for k, v in sent_cids.items() if now - v[1] > 600]:
                sent_cids.pop(k, None)
        sent_cids[(username, cid)] = (m, now)
    if g.get("type") == "dm" and len(q("SELECT 1 FROM messages WHERE group_id=? LIMIT 2", (gid,))) == 1:
        for n in g["members"]:  # first message: the DM now appears in the other person's list
            socketio.emit("groups_snapshot", {"groups": my_groups(n), "users": visible_users(n)}, to="user:" + n)
    socketio.emit("new_message", m, to=gid)
    if g.get("type") == "dm" and BOT_USER in g.get("members", []) and username != BOT_USER and text:
        threading.Timer(0.6, bot_respond, (gid, text)).start()
    return m, ""


@socketio.on("send_message")
def on_send_message(data):
    data = data or {}
    m, err = deliver_message(session.get("username"), str(data.get("group_id", "")), data.get("text", ""),
                             data.get("reply_to", ""), data.get("cid", ""))
    return {"ok": True, "id": m["id"], "message": m} if m else {"ok": False, "error": err}


@app.route("/api/messages", methods=["GET", "POST"])
@api_login
def api_messages():
    """HTTP fallback: works even when WebSocket / long-polling is blocked by the network."""
    username = session["username"]
    if request.method == "POST":
        p = request.get_json(silent=True) or {}
        m, err = deliver_message(username, str(p.get("group_id", "")), p.get("text", ""), p.get("reply_to", ""), p.get("cid", ""))
        return (jsonify(ok=True, id=m["id"], message=m), 200) if m else (jsonify(ok=False, error=err), 429 if "آهسته" in err else 400)
    gid = request.args.get("group_id", "")
    g = valid_group(username, gid)
    if not g:
        return jsonify(error="گروه پیدا نشد."), 404
    after = request.args.get("after", type=int)
    if after is None:
        msgs, more = fetch_page(gid)
    else:
        rows = q(SELECT_MSG + "WHERE m.group_id=? AND m.seq>? ORDER BY m.seq ASC LIMIT 200", (gid, after))
        users, more = read_json(USERS_FILE, {}), False
        msgs = [shape(r, users) for r in rows]
        attach_reactions(msgs)
    return jsonify(ok=True, messages=msgs, has_more=more, group=public_group(g))


@app.route("/api/upload", methods=["POST"])
@api_login
def api_upload():
    """Send a photo / video / audio / file. multipart form: file, group_id, text (caption), reply_to, cid."""
    username = session["username"]
    gid = str(request.form.get("group_id", ""))
    if not valid_group(username, gid):
        return _err("گروه پیدا نشد.", 404)
    f = request.files.get("file")
    if not f or not f.filename:
        return _err("فایلی انتخاب نشده است.")
    if not rate_ok("upload:" + username, 10, 60):
        return _err("کمی آهسته‌تر؛ فایل‌ها پشت‌سرهم ارسال می‌شوند.", 429)
    data = f.read(MAX_FILE_SIZE + 1)
    if len(data) > MAX_FILE_SIZE:
        return _err(f"حجم فایل بیشتر از {MAX_FILE_MB} مگابایت است.", 413)
    if not data:
        return _err("فایل خالی است.")
    name = clean_filename(f.filename)
    ext = file_ext(name)
    if ext in BLOCKED_EXT:
        return _err("ارسال این نوع فایل مجاز نیست.")
    kind = "image" if ext in IMAGE_MIME else "audio" if ext in AUDIO_MIME else "video" if ext in VIDEO_MIME else "file"
    if kind == "image" and not looks_like_image(data[:16]):
        return _err("فایل تصویر معتبر نیست.")
    mime = INLINE_MIME.get(ext) or mimetypes.guess_type(name)[0] or "application/octet-stream"
    stored = uuid.uuid4().hex + ext
    store_media(stored, mime, data)
    attach = {"file": stored, "name": name, "mime": mime, "size": len(data), "kind": kind,
              "url": "/media/" + stored + "?n=" + urllib.parse.quote(name)}
    m, err = deliver_message(username, gid, request.form.get("text", ""), request.form.get("reply_to", ""),
                             request.form.get("cid", ""), attach=json.dumps(attach, ensure_ascii=False))
    if not m:
        cleanup_media([stored])
        return _err(err, 429 if "آهسته" in err else 400)
    if (m.get("attach") or {}).get("file") != stored:      # a retry with the same cid: the first copy already exists
        cleanup_media([stored])
    return jsonify(ok=True, id=m["id"], message=m)


# ---------- reactions (one reaction per person per message, like Telegram) ----------
MSG_ID_RE = re.compile(r"[0-9a-f]{32}")


def valid_emoji(e):
    return 0 < len(e) <= 16 and all(ord(ch) > 0x7f for ch in e)


def attach_reactions(msgs):
    """Fills m["reactions"] for a list of shaped messages with one query per 300 ids."""
    ids = [m["id"] for m in msgs if m.get("id") and MSG_ID_RE.fullmatch(m["id"])]
    for i in range(0, len(ids), 300):
        part = reactions_for(ids[i:i + 300])
        for m in msgs:
            if m.get("id") in part:
                m["reactions"] = part[m["id"]]
    return msgs


def reactions_for(ids):
    out = {i: [] for i in ids}
    if not ids:
        return out
    rows = q("SELECT message_id, emoji, username FROM reactions WHERE message_id IN (" + ",".join("?" * len(ids))
             + ") ORDER BY created_at", tuple(ids))
    tmp = {}
    for r in rows:
        tmp.setdefault(r["message_id"], {}).setdefault(r["emoji"], []).append(r["username"])
    for mid, per in tmp.items():
        out[mid] = [{"emoji": em, "users": us} for em, us in sorted(per.items(), key=lambda kv: -len(kv[1]))]
    return out


@app.route("/api/reactions")
@api_login
def api_reactions():
    username = session["username"]
    ids = [i for i in request.args.get("ids", "").split(",") if MSG_ID_RE.fullmatch(i)][:200]
    if not ids:
        return jsonify(ok=True, reactions={})
    rows = q("SELECT id, group_id, text FROM messages WHERE id IN (" + ",".join("?" * len(ids)) + ")", tuple(ids))
    groups = read_json(GROUPS_FILE, {})
    rows = [r for r in rows if groups.get(r["group_id"]) and is_member(groups[r["group_id"]], username)]
    allowed = [r["id"] for r in rows]
    texts = {r["id"]: r["text"] for r in rows if r["text"] and not SPECIAL_RE.match(r["text"])}
    return jsonify(ok=True, reactions=reactions_for(allowed), texts=texts)


@app.route("/api/react", methods=["POST"])
@api_login
def api_react():
    """Toggle / change my reaction on a message. json: {id, emoji}. Same emoji again (or empty emoji) removes it."""
    username = session["username"]
    p = request.get_json(silent=True) or {}
    mid, emoji = str(p.get("id", "")), str(p.get("emoji", "")).strip()
    if not MSG_ID_RE.fullmatch(mid) or (emoji and not valid_emoji(emoji)):
        return _err("واکنش نامعتبر است.")
    row = q("SELECT group_id FROM messages WHERE id=?", (mid,), one=True)
    g = valid_group(username, row["group_id"]) if row else None
    if not g:
        return _err("پیام پیدا نشد.", 404)
    if not rate_ok("react:" + username, 40, 10):
        return _err("کمی آهسته‌تر.", 429)
    cur = q("SELECT emoji FROM reactions WHERE message_id=? AND username=?", (mid, username), one=True)
    if not emoji or (cur and cur["emoji"] == emoji):
        q("DELETE FROM reactions WHERE message_id=? AND username=?", (mid, username), commit=True)
    else:
        q("INSERT INTO reactions(message_id,username,emoji,created_at) VALUES(?,?,?,?) "
          "ON CONFLICT(message_id,username) DO UPDATE SET emoji=excluded.emoji, created_at=excluded.created_at",
          (mid, username, emoji, datetime.now(timezone.utc).isoformat()), commit=True)
    data = reactions_for([mid])[mid]
    socketio.emit("reaction_update", {"id": mid, "group_id": row["group_id"], "reactions": data}, to=row["group_id"])
    return jsonify(ok=True, id=mid, reactions=data)


# ---------- polls ----------
def poll_votes_for(ids):
    out = {i: [] for i in ids}
    if ids:
        for r in q("SELECT message_id, username, opt FROM poll_votes WHERE message_id IN (" + ",".join("?" * len(ids)) + ")", tuple(ids)):
            out[r["message_id"]].append([r["username"], r["opt"]])
    return out


@app.route("/api/polls")
@api_login
def api_polls():
    username = session["username"]
    ids = [i for i in request.args.get("ids", "").split(",") if MSG_ID_RE.fullmatch(i)][:200]
    if not ids:
        return jsonify(ok=True, polls={})
    placeholders = ",".join("?" for _ in ids)
    rows = q("SELECT id, group_id FROM messages WHERE id IN (" + placeholders + ")", tuple(ids))
    groups = read_json(GROUPS_FILE, {})
    rows = [r for r in rows if groups.get(r["group_id"]) and is_member(groups[r["group_id"]], username)]
    allowed = [r["id"] for r in rows]
    return jsonify(ok=True, polls=poll_votes_for(allowed))
