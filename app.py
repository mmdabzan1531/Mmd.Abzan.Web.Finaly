import base64, json, os, re, uuid, secrets, threading, random, sqlite3, hashlib, hmac, smtplib, ssl
import urllib.request, urllib.parse, urllib.error
from email.message import EmailMessage
from collections import defaultdict, deque
from contextlib import closing
from datetime import datetime, timezone
from functools import wraps
import time
import socket as pysocket
from flask import (Flask, render_template, request, redirect, url_for, session,
                   flash, jsonify, send_from_directory)
from flask_socketio import SocketIO, emit, join_room
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
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_IMAGE_SIZE = 4 * 1024 * 1024
PAGE = 60


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
    MAX_CONTENT_LENGTH=MAX_IMAGE_SIZE + 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.environ.get("RENDER_EXTERNAL_HOSTNAME")) or os.environ.get("CHATROOM_HTTPS") == "1",
    PERMANENT_SESSION_LIFETIME=60 * 24 * 3600,  # stay signed in for 60 days
)
app.jinja_env.globals["ASSET_V"] = str(int(time.time()))

# Realtime: Socket.IO behind a proxy (Render, nginx, ...) sees a different Origin/Host
# than the browser, so a strict origin check rejects the handshake and the chat stays
# on "connecting" forever. Sessions use SameSite=Lax cookies, so a cross-site page can't
# ride on a visitor's login anyway. Set CHATROOM_CORS="https://my.site" to restrict.
_cors = os.environ.get("CHATROOM_CORS", "*").strip()
socketio = SocketIO(
    app, async_mode="threading", ping_interval=20, ping_timeout=30,
    cors_allowed_origins="*" if _cors in ("", "*") else [x.strip() for x in _cors.split(",") if x.strip()],
    max_http_buffer_size=64 * 1024,
)

data_lock = threading.RLock()
online_sids = {}
recent_sends = defaultdict(deque)


# ---------- JSON store (users, groups) ----------
def write_json(path, value):
    with data_lock:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)


def read_json(path, default):
    with data_lock:
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            write_json(path, default)
            return default


# ---------- SQLite store (messages: permanent history) ----------
def db():
    c = sqlite3.connect(DB_FILE, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def q(sql, args=(), one=False, commit=False):
    with closing(db()) as c:
        rows = c.execute(sql, args).fetchall()
        if commit:
            c.commit()
        return (rows[0] if rows else None) if one else rows


SELECT_MSG = ("SELECT m.*, p.text AS reply_text, p.username AS reply_user "
              "FROM messages m LEFT JOIN messages p ON p.id = m.reply_to ")


def init_db():
    with closing(db()) as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("""CREATE TABLE IF NOT EXISTS messages(
            seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
            group_id TEXT NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL,
            created_at TEXT NOT NULL, reply_to TEXT DEFAULT '',
            edited INTEGER DEFAULT 0, forwarded_from TEXT DEFAULT '')""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_group_seq ON messages(group_id, seq)")
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
    if not os.path.exists(USERS_FILE):
        write_json(USERS_FILE, {})
    groups = read_json(GROUPS_FILE, {})
    groups.pop("general", None)  # no public chat anymore
    for gid, g in groups.items():
        g.setdefault("members", [])
        g.setdefault("owner", "")
        g.setdefault("type", "group")
        g.setdefault("invite_code", secrets.token_urlsafe(12))
    write_json(GROUPS_FILE, groups)
    init_db()


init_data()


def shape(r, users):
    u = users.get(r["username"], {})
    ru = users.get(r["reply_user"] or "", {})
    return {
        "id": r["id"], "seq": r["seq"], "group_id": r["group_id"], "username": r["username"],
        "display_name": u.get("display_name", r["username"]), "avatar": u.get("avatar", "🙂"),
        "avatar_url": u.get("avatar_url", ""), "text": r["text"], "created_at": r["created_at"],
        "edited": bool(r["edited"]), "forwarded_from": r["forwarded_from"] or "",
        "reply_to": r["reply_to"] or "",
        "reply_text": (r["reply_text"] or "")[:120],
        "reply_name": ru.get("display_name", r["reply_user"] or ""),
        "reply_gone": bool(r["reply_to"]) and r["reply_text"] is None,
    }


def fetch_page(gid, before=None, limit=PAGE):
    sql = SELECT_MSG + "WHERE m.group_id=? " + ("AND m.seq<? " if before else "") + "ORDER BY m.seq DESC LIMIT ?"
    rows = q(sql, (gid, before, limit + 1) if before else (gid, limit + 1))
    more = len(rows) > limit
    users = read_json(USERS_FILE, {})
    return [shape(r, users) for r in reversed(rows[:limit])], more


def fetch_one(mid):
    r = q(SELECT_MSG + "WHERE m.id=?", (mid,), one=True)
    return (r, shape(r, read_json(USERS_FILE, {}))) if r else (None, None)


def insert_message(gid, username, text, reply_to="", forwarded_from=""):
    mid = uuid.uuid4().hex
    q("INSERT INTO messages(id,group_id,username,text,created_at,reply_to,forwarded_from) VALUES(?,?,?,?,?,?,?)",
      (mid, gid, username, text, datetime.now(timezone.utc).isoformat(), reply_to, forwarded_from), commit=True)
    return fetch_one(mid)[1]


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
            "owner": g.get("owner", ""), "type": g.get("type", "group")}


def last_msg(gid):
    r = q("SELECT username,text,created_at,seq FROM messages WHERE group_id=? ORDER BY seq DESC LIMIT 1", (gid,), one=True)
    return {"username": r["username"], "text": r["text"][:60], "created_at": r["created_at"], "seq": r["seq"]} if r else None


def my_groups(username):
    out = {}
    for gid, g in read_json(GROUPS_FILE, {}).items():
        if not is_member(g, username):
            continue
        d = public_group(g); d["last"] = last_msg(gid)
        if g.get("type") == "dm" and not d["last"] and g.get("created_by") != username:
            continue  # an empty DM stays invisible to the other person
        out[gid] = d
    return out


def online_names():
    return sorted(set(online_sids.values()))


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
    return redirect(url_for("join_invite", invite_code=inv)) if inv else redirect(url_for("chat"))


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
def smtp_settings():
    if env("GMAIL_USER") and env("GMAIL_APP_PASSWORD"):
        return "smtp.gmail.com", 587, env("GMAIL_USER"), env("GMAIL_APP_PASSWORD").replace(" ", ""), env("GMAIL_USER")
    if env("SMTP_HOST"):
        return (env("SMTP_HOST"), int(env("SMTP_PORT", "587")), env("SMTP_USER"), env("SMTP_PASS").replace(" ", ""),
                env("SMTP_FROM") or env("SMTP_USER"))
    return None


def email_ready():
    return bool(smtp_settings() or (env("BREVO_API_KEY") and env("BREVO_SENDER")))


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
    cfg = smtp_settings()
    if cfg:
        host, port, user, pwd, sender = cfg
        try:
            msg = EmailMessage()
            msg["Subject"], msg["To"], msg["From"] = subject, to, f"ChatRoom | محمد مهدی آبزن <{sender}>" if sender else ""
            msg.set_content(text)
            msg.add_alternative(html, subtype="html")
            ctx = ssl.create_default_context()
            if port == 465:
                with smtplib.SMTP_SSL(host, port, timeout=15, context=ctx) as s:
                    if user: s.login(user, pwd)
                    s.send_message(msg)
            else:
                with smtplib.SMTP(host, port, timeout=15) as s:
                    s.ehlo(); s.starttls(context=ctx); s.ehlo()
                    if user: s.login(user, pwd)
                    s.send_message(msg)
            return True
        except Exception as e:
            print("[email] SMTP failed:", repr(e))
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
    print("\n  ---- verification codes ----")
    print("  email :", "READY" if email_ready() else "NOT configured (set GMAIL_USER + GMAIL_APP_PASSWORD)")
    print("  sms   :", "READY" if sms_ready() else "NOT configured (set KAVENEGAR_KEY / SMSIR_KEY / TWILIO_*)")
    if DEV_CODES:
        print("  !! CHATROOM_DEV_CODES=1 -> codes are shown on screen. Never use this on a public server.")


# ---------- ChatRoom assistant bot (a private chat every account gets) ----------
BOT_USER = "chatroom_bot"
BOT_PROFILE = {"display_name": "ChatRoom | محمد مهدی آبزن", "bio": "دستیار رسمی ChatRoom؛ آموزش، راهنما و پاسخ به پرسش‌های شما",
               "avatar": "🤖", "avatar_url": "/static/bot.jpg"}

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
          "۳. پیام را در کادر پایین بنویسید و دکمه‌ی ➤ را بزنید.\n"
          "۴. با نگه داشتن یا کلیک روی یک پیام می‌توانید پاسخ بدهید، ویرایش کنید، حذف کنید یا آن را به گفتگوی دیگری بفرستید؛ ویرایش و حذف فقط برای پیام‌های خودتان ممکن است.\n"
          "۵. تنظیمات، پشتیبانی و خروج از حساب در پایین ستون کناری قرار دارند."),
    "2": ("👥 ساخت گروه و دعوت دوستان\n"
          "۱. دکمه‌ی «+» را بزنید، نام و توضیحات گروه را بنویسید و «ساخت گروه» را انتخاب کنید.\n"
          "۲. داخل گروه روی «لینک دعوت» بزنید و لینک را برای دوستانتان بفرستید؛ هر کس با آن وارد شود، عضو گروه می‌شود.\n"
          "۳. فهرست اعضا از دکمه‌ی «اعضا» در بالای صفحه نمایش داده می‌شود.\n"
          "۴. فقط سازنده‌ی گروه می‌تواند نام و توضیحات را از «تنظیمات» گروه تغییر دهد."),
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
          "• پیام خصوصی و گروه‌های دعوت‌محور\n"
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
    return send_from_directory(UPLOAD_DIR, filename, max_age=30 * 24 * 3600)


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


_DUMMY_HASH = generate_password_hash("not-a-real-password")


@app.route("/", methods=["GET", "POST"])
def index():
    if "username" in session:
        return redirect(url_for("chat"))
    need = session.get("login_fails", 0) >= 3          # captcha only after repeated failures (like big sites)
    if request.method == "GET":
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
    return render_template("signup.html", captcha_question=new_captcha())


@app.route("/forgot")
def forgot_page():
    if "username" in session:
        return redirect(url_for("chat"))
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
    with data_lock:
        users = read_json(USERS_FILE, {})
        if any(n.lower() == rec["username"].lower() for n in users):
            return jsonify(error="این نام کاربری همین الان گرفته شد."), 409
        users[rec["username"]] = {"username": rec["username"], "password_hash": rec["password_hash"], "display_name": rec["display_name"],
                                  "bio": "", "avatar": "🙂", "avatar_url": "", "email": rec["email"], "phone": rec["phone"],
                                  "show_email": False, "show_phone": False, "created_at": datetime.now(timezone.utc).isoformat()}
        write_json(USERS_FILE, users)
    pending.pop(token, None)
    onboard_bot_chat(rec["username"])
    inv = login_user(rec["username"])
    return jsonify(ok=True, redirect=url_for("join_invite", invite_code=inv) if inv else url_for("chat"))


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
    if name:
        u, em, ph = users[name], norm_email(ident), norm_phone(ident)
        if em and u.get("email") == em: rec["email"] = em            # reply on the channel the person typed
        elif ph and u.get("phone") == ph: rec["phone"] = ph
        elif u.get("email"): rec["email"] = u["email"]                # typed a username: email first, then phone
        else: rec["phone"] = u.get("phone", "")
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
    return jsonify(ok=True, redirect=url_for("chat"))


@app.route("/chat")
@logged_in
def chat():
    username = session["username"]
    users = read_json(USERS_FILE, {})
    if username not in users:
        session.clear()
        return redirect(url_for("index"))
    session.permanent = True
    return render_template("chat.html", current_user=safe_user_public(users[username], True),
                           groups=my_groups(username), users=visible_users(username))


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
    username = session["username"]
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
            filename = f"{uuid.uuid4().hex}{ext}"
            photo.save(os.path.join(UPLOAD_DIR, filename))
            users[username]["avatar_url"] = "/media/" + filename
        users[username].update(display_name=display_name, bio=bio, avatar=avatar,
                               show_phone=request.form.get("show_phone") == "1", show_email=request.form.get("show_email") == "1")
        users[username].setdefault("avatar_url", "")
        write_json(USERS_FILE, users)
        pub = safe_user_public(users[username])
        full = safe_user_public(users[username], True)
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
                       "invite_code": secrets.token_urlsafe(12)}
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
        if g.get("owner") not in ("system", username):
            return jsonify(error="فقط سازنده گروه می‌تواند تنظیمات را تغییر دهد."), 403
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
                     "year": str(y).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))}}


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
    for gid in my_groups(username):
        join_room(gid)
    emit("groups_snapshot", {"groups": my_groups(username)})
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
    counts = {}
    for gid in my_groups(username):
        seq = last_read.get(gid)
        if isinstance(seq, int):
            counts[gid] = q("SELECT COUNT(*) c FROM messages WHERE group_id=? AND seq>? AND username!=?",
                            (gid, seq, username), one=True)["c"]
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


def deliver_message(username, gid, text, reply_to="", cid=""):
    """Single code path for sending (Socket.IO and the HTTP fallback). Returns (message, error)."""
    text, cid = str(text or "").strip()[:1000], str(cid or "")[:40]
    g = valid_group(username, gid) if username else None
    if not g or not text:
        return None, "ارسال پیام ممکن نیست."
    hit = sent_cids.get((username, cid)) if cid else None
    if hit:
        return hit[0], ""
    if not rate_ok("send:" + username, 20, 10):
        return None, "کمی آهسته‌تر؛ پیام‌ها پشت‌سرهم ارسال می‌شوند."
    reply_to = str(reply_to or "")[:50]
    if reply_to and not q("SELECT 1 FROM messages WHERE id=? AND group_id=?", (reply_to, gid), one=True):
        reply_to = ""
    m = insert_message(gid, username, text, reply_to=reply_to)
    m["cid"] = cid
    if cid:
        now = time.time()
        if len(sent_cids) > 3000:
            for k in [k for k, v in sent_cids.items() if now - v[1] > 600]:
                sent_cids.pop(k, None)
        sent_cids[(username, cid)] = (m, now)
    if g.get("type") == "dm" and q("SELECT COUNT(*) c FROM messages WHERE group_id=?", (gid,), one=True)["c"] == 1:
        for n in g["members"]:  # first message: the DM now appears in the other person's list
            socketio.emit("groups_snapshot", {"groups": my_groups(n), "users": visible_users(n)}, to="user:" + n)
    socketio.emit("new_message", m, to=gid)
    if g.get("type") == "dm" and BOT_USER in g.get("members", []) and username != BOT_USER:
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
    return jsonify(ok=True, messages=msgs, has_more=more, group=public_group(g))


@socketio.on("typing")
def on_typing(data):
    username = session.get("username")
    data = data or {}
    gid = str(data.get("group_id", ""))
    if username and valid_group(username, gid):
        emit("typing", {"group_id": gid, "username": username, "typing": bool(data.get("typing", True))},
             to=gid, include_self=False)


@socketio.on("edit_message")
def on_edit_message(data):
    username = session.get("username")
    data = data or {}
    mid = str(data.get("id", ""))
    text = str(data.get("text", "")).strip()[:1000]
    if not username or not text:
        return
    row, _ = fetch_one(mid)
    if not row or row["username"] != username or not valid_group(username, row["group_id"]):
        emit("action_error", {"error": "فقط می‌توانی پیام خودت را ویرایش کنی."})
        return
    q("UPDATE messages SET text=?, edited=1 WHERE id=?", (text, mid), commit=True)
    emit("message_updated", fetch_one(mid)[1], to=row["group_id"])


@socketio.on("delete_message")
def on_delete_message(data):
    username = session.get("username")
    mid = str((data or {}).get("id", ""))
    if not username:
        return
    row, _ = fetch_one(mid)
    if not row or row["username"] != username or not valid_group(username, row["group_id"]):
        emit("action_error", {"error": "اجازه حذف این پیام را نداری."})
        return
    q("DELETE FROM messages WHERE id=?", (mid,), commit=True)
    emit("message_deleted", {"id": mid, "group_id": row["group_id"]}, to=row["group_id"])


@socketio.on("forward_message")
def on_forward_message(data):
    username = session.get("username")
    data = data or {}
    mid = str(data.get("id", ""))
    target = str(data.get("target_group", ""))
    if not username or not valid_group(username, target):
        emit("action_error", {"error": "گروه مقصد معتبر نیست یا عضو آن نیستی."})
        return
    row, shaped = fetch_one(mid)
    if not row or not valid_group(username, row["group_id"]):
        return
    m = insert_message(target, username, row["text"], forwarded_from=shaped["display_name"])
    emit("new_message", m, to=target)


ensure_bot()
for _n in list(read_json(USERS_FILE, {})):
    onboard_bot_chat(_n)

startup_report()


def lan_ip():
    try:
        with pysocket.socket(pysocket.AF_INET, pysocket.SOCK_DGRAM) as sk:
            sk.connect(("10.255.255.255", 1))
            return sk.getsockname()[0]
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  Chatroom is running\n  This device : http://127.0.0.1:{port}\n  Same Wi-Fi  : http://{lan_ip()}:{port}\n")
    socketio.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=port, debug=False, allow_unsafe_werkzeug=True)
