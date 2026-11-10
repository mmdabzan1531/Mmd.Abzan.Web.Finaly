# -*- coding: utf-8 -*-
"""
Insta Mode backend with independent Insta accounts, posts, reels, stories, follows and direct messages.

Hooked into app.py with: import insta; insta.register(globals())

Insta identities, stories and DMs use their own SQL tables and session key. Only the shared
media storage helper is reused; Chatroom users, sessions, stories and DMs are not used.
"""
import os, re, time, uuid
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

from flask import request, session, jsonify, render_template, redirect, url_for


def register(g):
    app = g["app"]
    q = g["q"]
    read_json = g["read_json"]
    USERS_FILE = g["USERS_FILE"]
    # Insta has its own identity/session namespace; it never authenticates via chat users.
    is_blocked = lambda users, a, b: False
    store_media = g["store_media"]
    remove_media_url = g["remove_media_url"]
    looks_like_image = g["looks_like_image"]
    clean_filename = g["clean_filename"]
    file_ext = g["file_ext"]
    rate_ok = g["rate_ok"]
    my_groups = lambda username: {}
    BOT_USER = "__insta_system__"
    IMAGE_MIME = g["IMAGE_MIME"]
    VIDEO_MIME = g["VIDEO_MIME"]
    MAX_FILE_MB = int(os.environ.get("INSTA_MAX_UPLOAD_MB", "500"))
    MAX_FILE_SIZE = MAX_FILE_MB * 1024 * 1024
    MAX_IMAGE_SIZE = MAX_FILE_SIZE
    app.config["MAX_CONTENT_LENGTH"] = max(int(app.config.get("MAX_CONTENT_LENGTH", 0) or 0), MAX_FILE_SIZE + 2 * 1024 * 1024)

    PAGE = 12
    GRID = 30

    # ------------------------------------------------------------------ independent Insta accounts
    q("CREATE TABLE IF NOT EXISTS insta_accounts (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, phone TEXT UNIQUE, email TEXT UNIQUE, display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '🙂', avatar_url TEXT NOT NULL DEFAULT '', private_account INTEGER NOT NULL DEFAULT 0, created_at DOUBLE PRECISION NOT NULL)", commit=True)
    q("CREATE TABLE IF NOT EXISTS insta_stories (id TEXT PRIMARY KEY, username TEXT NOT NULL, kind TEXT NOT NULL, media_url TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', created_at DOUBLE PRECISION NOT NULL, expires_at DOUBLE PRECISION NOT NULL)", commit=True)
    q("CREATE TABLE IF NOT EXISTS insta_story_views (story_id TEXT NOT NULL, username TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL, PRIMARY KEY(story_id,username))", commit=True)
    q("CREATE TABLE IF NOT EXISTS insta_dm_threads (id TEXT PRIMARY KEY, pair_key TEXT UNIQUE NOT NULL, user1 TEXT NOT NULL, user2 TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL)", commit=True)
    q("CREATE TABLE IF NOT EXISTS insta_dm_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL, seq DOUBLE PRECISION NOT NULL, created_at DOUBLE PRECISION NOT NULL)", commit=True)

    def insta_users():
        rows = q("SELECT username, display_name, bio, avatar, avatar_url, private_account FROM insta_accounts")
        return {r["username"]: {"username": r["username"], "display_name": r["display_name"], "bio": r["bio"],
                "avatar": r["avatar"], "avatar_url": r["avatar_url"], "private_account": bool(r["private_account"]),
                "premium": False} for r in rows}

    def insta_required(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if "insta_username" not in session:
                return jsonify(error="برای استفاده از اینستا ابتدا وارد حساب اینستای خودت شو."), 401
            return fn(*args, **kwargs)
        return wrapped

    api_login = insta_required
    logged_in = insta_required

    # ------------------------------------------------------------------ tables
    for ddl in (
        "CREATE TABLE IF NOT EXISTS insta_posts(id TEXT PRIMARY KEY, username TEXT NOT NULL, kind TEXT NOT NULL, "
        "media_type TEXT NOT NULL, media_url TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', created_at DOUBLE PRECISION NOT NULL)",
        "CREATE TABLE IF NOT EXISTS insta_likes(post_id TEXT NOT NULL, username TEXT NOT NULL, "
        "created_at DOUBLE PRECISION NOT NULL, PRIMARY KEY(post_id, username))",
        "CREATE TABLE IF NOT EXISTS insta_comments(id TEXT PRIMARY KEY, post_id TEXT NOT NULL, username TEXT NOT NULL, "
        "text TEXT NOT NULL, created_at DOUBLE PRECISION NOT NULL)",
        "CREATE TABLE IF NOT EXISTS insta_saves(post_id TEXT NOT NULL, username TEXT NOT NULL, "
        "created_at DOUBLE PRECISION NOT NULL, PRIMARY KEY(post_id, username))",
        "CREATE TABLE IF NOT EXISTS insta_follows(follower TEXT NOT NULL, followee TEXT NOT NULL, "
        "status TEXT NOT NULL DEFAULT 'accepted', created_at DOUBLE PRECISION NOT NULL, PRIMARY KEY(follower, followee))",
        "CREATE INDEX IF NOT EXISTS idx_insta_posts_time ON insta_posts(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_insta_posts_user ON insta_posts(username, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_insta_comments_post ON insta_comments(post_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_insta_follows_followee ON insta_follows(followee)",
    ):
        q(ddl, commit=True)

    # ------------------------------------------------------------------ helpers
    def err(msg, code=400):
        return jsonify(error=msg), code

    def mini(u):
        """The few public fields the UI needs about a person."""
        return {"username": u["username"], "display_name": u.get("display_name", u["username"]),
                "avatar": u.get("avatar", "🙂"), "avatar_url": u.get("avatar_url", ""),
                "premium": False, "private_account": bool(u.get("private_account", False))}

    def following_of(me):
        return {r["followee"] for r in q("SELECT followee FROM insta_follows WHERE follower=? AND status='accepted'", (me,))}

    def hidden_users(me, users, following):
        """People whose content I must not see: blocked either way, or private accounts I don't follow."""
        hid = {BOT_USER}
        for n, u in users.items():
            if n == me:
                continue
            if is_blocked(users, n, me) or is_blocked(users, me, n):
                hid.add(n)
            elif u.get("private_account") and n not in following:
                hid.add(n)
        return hid

    def can_view(me, owner, users, following):
        if owner == me:
            return True
        if owner not in users or owner == BOT_USER:
            return False
        if is_blocked(users, owner, me) or is_blocked(users, me, owner):
            return False
        if users[owner].get("private_account") and owner not in following:
            return False
        return True

    def ph(n):
        return ",".join("?" * n)

    def shape_posts(rows, me, users):
        rows = list(rows)
        ids = [r["id"] for r in rows]
        if not ids:
            return []
        p, t = ph(len(ids)), tuple(ids)
        likes = {r["post_id"]: int(r["c"]) for r in q(
            f"SELECT post_id, COUNT(*) c FROM insta_likes WHERE post_id IN ({p}) GROUP BY post_id", t)}
        coms = {r["post_id"]: int(r["c"]) for r in q(
            f"SELECT post_id, COUNT(*) c FROM insta_comments WHERE post_id IN ({p}) GROUP BY post_id", t)}
        liked = {r["post_id"] for r in q(
            f"SELECT post_id FROM insta_likes WHERE username=? AND post_id IN ({p})", (me,) + t)}
        saved = {r["post_id"] for r in q(
            f"SELECT post_id FROM insta_saves WHERE username=? AND post_id IN ({p})", (me,) + t)}
        out = []
        for r in rows:
            u = users.get(r["username"])
            if not u:
                continue
            out.append({"id": r["id"], "user": mini(u), "kind": r["kind"], "media_type": r["media_type"],
                        "media_url": r["media_url"], "caption": r["caption"], "created_at": float(r["created_at"]),
                        "likes": likes.get(r["id"], 0), "comments": coms.get(r["id"], 0),
                        "liked": r["id"] in liked, "saved": r["id"] in saved, "mine": r["username"] == me})
        return out

    def page_response(rows, limit, me, users):
        more = len(rows) > limit
        rows = rows[:limit]
        posts = shape_posts(rows, me, users)
        return jsonify(ok=True, posts=posts, has_more=more, next=(float(rows[-1]["created_at"]) if rows else None))

    def get_visible_post(pid, me):
        r = q("SELECT * FROM insta_posts WHERE id=?", (pid,), one=True)
        if not r:
            return None
        users = insta_users()
        if not can_view(me, r["username"], users, following_of(me)):
            return None
        return r

    def before_arg():
        v = request.args.get("before", type=float)
        return v if v else time.time() + 5

    # ------------------------------------------------------------------ page
    @app.route("/insta", methods=["GET"])
    def insta_page():
        username = session.get("insta_username")
        if not username:
            return redirect("/auth/insta")
        users = insta_users()
        if username not in users:
            session.pop("insta_username", None)
            return redirect("/auth/insta")
        return render_template("insta.html", current_user=users[username])

    # ------------------------------------------------------------------ sign-up / sign-in (every bad value is checked with an `if`)
    USERNAME_RE = re.compile(r"[a-z0-9_.]{3,30}")
    parse_contact = g["parse_contact"]
    dummy_hash = g.get("_DUMMY_HASH")

    def text_field(d, key, maxlen):
        """Return the stripped text of d[key]. Raises TypeError for lists/dicts/bools, ValueError when too long."""
        v = d.get(key)
        if v is None:
            return ""
        if isinstance(v, bool) or not isinstance(v, (str, int)):
            raise TypeError(key)
        v = str(v).strip()
        if len(v) > maxlen:
            raise ValueError(key)
        return v

    def client_key():
        return request.remote_addr or "?"

    @app.route("/api/insta/auth/register", methods=["POST"])
    def insta_register_account():
        d = request.get_json(silent=True)
        if not isinstance(d, dict):
            return err("درخواست نامعتبر است.")
        try:
            username = text_field(d, "username", 30).lower().lstrip("@")
            display = text_field(d, "display_name", 60)
            contact = text_field(d, "contact", 120) or text_field(d, "email", 120) or text_field(d, "phone", 40)
            password = d.get("password", "")
        except TypeError:
            return err("مقدار یکی از فیلدها معتبر نیست.")
        except ValueError as e:
            return err("یکی از فیلدها بیش از حد طولانی است (%s)." % e)
        if not isinstance(password, str):
            return err("رمز عبور معتبر نیست.")
        if not username:
            return err("نام کاربری را وارد کن.")
        if not USERNAME_RE.fullmatch(username):
            return err("نام کاربری باید ۳ تا ۳۰ حرف انگلیسی، عدد، _ یا نقطه باشد.")
        if username.startswith(".") or username.endswith(".") or ".." in username:
            return err("نام کاربری نباید با نقطه شروع یا تمام شود و دو نقطه پشت سر هم نداشته باشد.")
        if not contact:
            return err("شماره تلفن یا ایمیل را وارد کن.")
        email, phone, contact_err = parse_contact(contact)
        if contact_err:
            return err(contact_err)
        if len(password) < 8:
            return err("رمز عبور باید حداقل ۸ کاراکتر باشد.")
        if len(password) > 128:
            return err("رمز عبور نباید بیشتر از ۱۲۸ کاراکتر باشد.")
        if password.lower() == username:
            return err("رمز عبور نباید با نام کاربری یکی باشد.")
        display = re.sub(r"[\x00-\x1f\x7f]", "", display).strip() or username
        if not rate_ok("insta-reg:" + client_key(), 10, 600):
            return err("تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کن.", 429)
        if q("SELECT 1 FROM insta_accounts WHERE lower(username)=?", (username,), one=True):
            return err("این نام کاربری قبلاً گرفته شده است.", 409)
        if email and q("SELECT 1 FROM insta_accounts WHERE lower(email)=?", (email,), one=True):
            return err("با این ایمیل قبلاً حساب اینستا ساخته شده است.", 409)
        if phone and q("SELECT 1 FROM insta_accounts WHERE phone=?", (phone,), one=True):
            return err("با این شماره قبلاً حساب اینستا ساخته شده است.", 409)
        try:
            q("INSERT INTO insta_accounts(username,password_hash,phone,email,display_name,created_at) VALUES(?,?,?,?,?,?)",
              (username, generate_password_hash(password), phone or None, email or None, display, time.time()), commit=True)
        except Exception:
            return err("این نام کاربری، شماره یا ایمیل قبلاً ثبت شده است.", 409)
        # No auto-login: the sign-up page wipes itself and shows the login form.
        return jsonify(ok=True, registered=True, message="حساب اینستا ساخته شد. حالا وارد شو.")

    @app.route("/api/insta/auth/login", methods=["POST"])
    def insta_login_account():
        d = request.get_json(silent=True)
        if not isinstance(d, dict):
            return err("درخواست نامعتبر است.")
        try:
            key = text_field(d, "login", 120).lower().lstrip("@")
        except TypeError:
            return err("نام کاربری یا ایمیل معتبر نیست.")
        except ValueError:
            return err("نام کاربری یا ایمیل خیلی طولانی است.")
        password = d.get("password", "")
        if not isinstance(password, str):
            return err("رمز عبور معتبر نیست.")
        if not key:
            return err("نام کاربری، ایمیل یا شماره را وارد کن.")
        if not password:
            return err("رمز عبور را وارد کن.")
        if len(password) > 128:
            return err("اطلاعات ورود صحیح نیست.", 401)
        if not rate_ok("insta-login-ip:" + client_key(), 60, 600) or not rate_ok("insta-login:" + client_key() + ":" + key, 8, 600):
            return err("تعداد تلاش‌ها زیاد بود؛ چند دقیقه بعد دوباره امتحان کن.", 429)
        em, ph, _ = parse_contact(key)              # a typed phone/email may be written differently than stored
        row = q("SELECT username,password_hash FROM insta_accounts WHERE lower(username)=? OR lower(email)=? OR phone IN (?,?)",
                (key, em or key, key, ph or key), one=True)
        if not row:
            if dummy_hash:
                check_password_hash(dummy_hash, password)       # same time whether or not the account exists
            return err("اطلاعات ورود صحیح نیست.", 401)
        if not check_password_hash(row["password_hash"], password):
            return err("اطلاعات ورود صحیح نیست.", 401)
        session["insta_username"] = row["username"]
        session.permanent = True
        return jsonify(ok=True, username=row["username"], redirect="/insta")

    @app.route("/api/insta/auth/logout", methods=["POST"])
    def insta_logout_account():
        session.pop("insta_username", None)
        return jsonify(ok=True)

    # ------------------------------------------------------------------ Insta-only stories (never uses Chatroom stories)
    @app.route("/api/insta/stories", methods=["GET", "POST"])
    @api_login
    def insta_stories():
        me = session["insta_username"]
        users = insta_users()
        if request.method == "POST":
            f = request.files.get("file")
            if not f or not f.filename:
                return err("یک عکس یا ویدیو برای استوری انتخاب کن.")
            ext = file_ext(clean_filename(f.filename))
            video = ext in VIDEO_MIME
            if not video and ext not in IMAGE_MIME:
                return err("فرمت فایل پشتیبانی نمی‌شود.")
            data = f.read(MAX_FILE_SIZE + 1)
            if not data or len(data) > MAX_FILE_SIZE:
                return err(f"حجم فایل باید کمتر از {MAX_FILE_MB} مگابایت باشد.", 413)
            if not video and not looks_like_image(data[:16]):
                return err("فایل تصویر معتبر نیست.")
            name = uuid.uuid4().hex + ext
            store_media(name, (VIDEO_MIME if video else IMAGE_MIME)[ext], data)
            sid = uuid.uuid4().hex[:16]; now = time.time()
            q("INSERT INTO insta_stories(id,username,kind,media_url,caption,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
              (sid,me,"video" if video else "image","/media/"+name,str(request.form.get("caption", ""))[:500],now,now+86400),commit=True)
            return jsonify(ok=True,id=sid)
        rows = q("SELECT * FROM insta_stories WHERE expires_at>? ORDER BY created_at", (time.time(),))
        grouped = {}
        for r in rows:
            owner = r["username"]
            if owner not in users: continue
            g = grouped.setdefault(owner,{"user":mini(users[owner]),"stories":[],"unseen":False})
            viewed = bool(q("SELECT 1 FROM insta_story_views WHERE story_id=? AND username=?",(r["id"],me),one=True))
            g["stories"].append({"id":r["id"],"kind":r["kind"],"media_url":r["media_url"],"caption":r["caption"],"created_at":float(r["created_at"]),"viewed":viewed,"views_count":int(q("SELECT COUNT(*) c FROM insta_story_views WHERE story_id=?",(r["id"],),one=True)["c"])})
            if owner != me and not viewed: g["unseen"] = True
        return jsonify(ok=True,groups=list(grouped.values()))

    @app.route("/api/insta/stories/<sid>", methods=["DELETE"])
    @api_login
    def insta_story_delete(sid):
        me=session["insta_username"]; r=q("SELECT * FROM insta_stories WHERE id=? AND username=?",(sid,me),one=True)
        if not r:return err("استوری پیدا نشد.",404)
        q("DELETE FROM insta_story_views WHERE story_id=?",(sid,),commit=True);q("DELETE FROM insta_stories WHERE id=?",(sid,),commit=True);remove_media_url(r["media_url"]);return jsonify(ok=True)

    @app.route("/api/insta/stories/<sid>/view", methods=["POST"])
    @api_login
    def insta_story_view(sid):
        me=session["insta_username"];r=q("SELECT id FROM insta_stories WHERE id=? AND expires_at>?",(sid,time.time()),one=True)
        if not r:return err("استوری پیدا نشد.",404)
        q("INSERT INTO insta_story_views(story_id,username,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING",(sid,me,time.time()),commit=True);return jsonify(ok=True)

    # ------------------------------------------------------------------ feeds
    @app.route("/api/insta/feed")
    @api_login
    def insta_feed():
        me = session["insta_username"]
        users = insta_users()
        fol = following_of(me)
        hid = hidden_users(me, users, fol)
        names = [n for n in ({me} | fol) if n in users and n not in hid]
        rows = q(f"SELECT * FROM insta_posts WHERE username IN ({ph(len(names))}) AND created_at < ? "
                 "ORDER BY created_at DESC LIMIT ?", tuple(names) + (before_arg(), PAGE + 1))
        return page_response(rows, PAGE, me, users)

    def open_feed(extra_sql, extra_args, limit):
        me = session["insta_username"]
        users = insta_users()
        hid = hidden_users(me, users, following_of(me))
        sql = "SELECT * FROM insta_posts WHERE created_at < ? " + extra_sql
        args = [before_arg()] + list(extra_args)
        if hid:
            sql += f"AND username NOT IN ({ph(len(hid))}) "
            args += list(hid)
        rows = q(sql + "ORDER BY created_at DESC LIMIT ?", tuple(args) + (limit + 1,))
        return page_response(rows, limit, me, users)

    @app.route("/api/insta/explore")
    @api_login
    def insta_explore():
        return open_feed("", (), GRID)

    @app.route("/api/insta/reels")
    @api_login
    def insta_reels():
        return open_feed("AND kind=? ", ("reel",), PAGE)

    @app.route("/api/insta/saved")
    @api_login
    def insta_saved():
        me = session["insta_username"]
        users = insta_users()
        fol = following_of(me)
        rows = q("SELECT p.* FROM insta_posts p JOIN insta_saves s ON s.post_id = p.id WHERE s.username=? "
                 "ORDER BY s.created_at DESC LIMIT 200", (me,))
        rows = [r for r in rows if can_view(me, r["username"], users, fol)]
        return jsonify(ok=True, posts=shape_posts(rows, me, users), has_more=False)

    # ------------------------------------------------------------------ create / read / delete post
    @app.route("/api/insta/posts", methods=["POST"])
    @api_login
    def insta_create():
        me = session["insta_username"]
        kind = request.form.get("kind", "post")
        if kind not in ("post", "reel"):
            return err("نوع پست نامعتبر است.")
        f = request.files.get("file")
        if not f or not f.filename:
            return err("یک عکس یا ویدیو انتخاب کن.")
        if not rate_ok("insta_post:" + me, 6, 60):
            return err("کمی آهسته‌تر؛ پست‌ها پشت‌سرهم ارسال می‌شوند.", 429)
        ext = file_ext(clean_filename(f.filename))
        is_video = ext in VIDEO_MIME
        is_image = ext in IMAGE_MIME
        if not (is_video or is_image):
            return err("فرمت فایل پشتیبانی نمی‌شود (عکس: jpg/png/webp/gif ـ ویدیو: mp4/webm/mov).")
        if kind == "reel" and not is_video:
            return err("ریلز باید ویدیو باشد.")
        limit = MAX_FILE_SIZE if is_video else MAX_IMAGE_SIZE
        data = f.read(limit + 1)
        if not data:
            return err("فایل خالی است.")
        if len(data) > limit:
            return err(f"حجم فایل باید کمتر از {MAX_FILE_MB if is_video else MAX_IMAGE_SIZE // (1024 * 1024)} مگابایت باشد.", 413)
        if is_image and not looks_like_image(data[:16]):
            return err("فایل تصویر معتبر نیست.")
        caption = str(request.form.get("caption", "")).strip()[:2200]
        name = uuid.uuid4().hex + ext
        store_media(name, (VIDEO_MIME if is_video else IMAGE_MIME)[ext], data)
        pid = uuid.uuid4().hex[:16]
        q("INSERT INTO insta_posts(id, username, kind, media_type, media_url, caption, created_at) VALUES(?,?,?,?,?,?,?)",
          (pid, me, kind, "video" if is_video else "image", "/media/" + name, caption, time.time()), commit=True)
        users = insta_users()
        post = shape_posts([q("SELECT * FROM insta_posts WHERE id=?", (pid,), one=True)], me, users)[0]
        return jsonify(ok=True, post=post)

    @app.route("/api/insta/posts/<pid>")
    @api_login
    def insta_post(pid):
        me = session["insta_username"]
        r = get_visible_post(pid, me)
        if not r:
            return err("پست پیدا نشد.", 404)
        return jsonify(ok=True, post=shape_posts([r], me, insta_users())[0])

    @app.route("/api/insta/posts/<pid>", methods=["DELETE"])
    @api_login
    def insta_delete(pid):
        me = session["insta_username"]
        r = q("SELECT * FROM insta_posts WHERE id=?", (pid,), one=True)
        if not r or r["username"] != me:
            return err("پست پیدا نشد.", 404)
        for t in ("insta_likes", "insta_comments", "insta_saves"):
            q(f"DELETE FROM {t} WHERE post_id=?", (pid,), commit=True)
        q("DELETE FROM insta_posts WHERE id=?", (pid,), commit=True)
        remove_media_url(r["media_url"])
        return jsonify(ok=True)

    @app.route("/api/insta/posts/<pid>/caption", methods=["POST"])
    @api_login
    def insta_caption(pid):
        me = session["insta_username"]
        r = q("SELECT username FROM insta_posts WHERE id=?", (pid,), one=True)
        if not r or r["username"] != me:
            return err("پست پیدا نشد.", 404)
        cap = str((request.get_json(silent=True) or {}).get("caption", "")).strip()[:2200]
        q("UPDATE insta_posts SET caption=? WHERE id=?", (cap, pid), commit=True)
        return jsonify(ok=True, caption=cap)

    # ------------------------------------------------------------------ like / save
    def toggle(table, pid):
        me = session["insta_username"]
        if not get_visible_post(pid, me):
            return None
        want = (request.get_json(silent=True) or {}).get("on")
        has = q(f"SELECT 1 FROM {table} WHERE post_id=? AND username=?", (pid, me), one=True)
        want = (not has) if want is None else bool(want)
        if want and not has:
            if not rate_ok("insta_tog:" + me, 60, 30):
                return "rate"
            q(f"INSERT INTO {table}(post_id, username, created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING",
              (pid, me, time.time()), commit=True)
        elif not want and has:
            q(f"DELETE FROM {table} WHERE post_id=? AND username=?", (pid, me), commit=True)
        return want

    @app.route("/api/insta/posts/<pid>/like", methods=["POST"])
    @api_login
    def insta_like(pid):
        on = toggle("insta_likes", pid)
        if on is None:
            return err("پست پیدا نشد.", 404)
        if on == "rate":
            return err("کمی آهسته‌تر.", 429)
        n = int(q("SELECT COUNT(*) c FROM insta_likes WHERE post_id=?", (pid,), one=True)["c"])
        return jsonify(ok=True, liked=bool(on), likes=n)

    @app.route("/api/insta/posts/<pid>/save", methods=["POST"])
    @api_login
    def insta_save(pid):
        on = toggle("insta_saves", pid)
        if on is None:
            return err("پست پیدا نشد.", 404)
        if on == "rate":
            return err("کمی آهسته‌تر.", 429)
        return jsonify(ok=True, saved=bool(on))

    # ------------------------------------------------------------------ comments
    @app.route("/api/insta/posts/<pid>/comments", methods=["GET", "POST"])
    @api_login
    def insta_comments(pid):
        me = session["insta_username"]
        post = get_visible_post(pid, me)
        if not post:
            return err("پست پیدا نشد.", 404)
        users = insta_users()
        if request.method == "POST":
            text = str((request.get_json(silent=True) or {}).get("text", "")).strip()[:500]
            if not text:
                return err("متن نظر خالی است.")
            if not rate_ok("insta_com:" + me, 12, 60):
                return err("کمی آهسته‌تر؛ نظرها پشت‌سرهم ارسال می‌شوند.", 429)
            cid = uuid.uuid4().hex[:16]
            q("INSERT INTO insta_comments(id, post_id, username, text, created_at) VALUES(?,?,?,?,?)",
              (cid, pid, me, text, time.time()), commit=True)
        rows = q("SELECT * FROM insta_comments WHERE post_id=? ORDER BY created_at ASC LIMIT 300", (pid,))
        out = []
        for r in rows:
            u = users.get(r["username"])
            if not u or is_blocked(users, r["username"], me) or is_blocked(users, me, r["username"]):
                continue
            out.append({"id": r["id"], "user": mini(u), "text": r["text"], "created_at": float(r["created_at"]),
                        "can_delete": r["username"] == me or post["username"] == me})
        return jsonify(ok=True, comments=out)

    @app.route("/api/insta/comments/<cid>", methods=["DELETE"])
    @api_login
    def insta_comment_delete(cid):
        me = session["insta_username"]
        r = q("SELECT c.id, c.username, p.username AS owner FROM insta_comments c JOIN insta_posts p ON p.id = c.post_id "
              "WHERE c.id=?", (cid,), one=True)
        if not r or me not in (r["username"], r["owner"]):
            return err("نظر پیدا نشد.", 404)
        q("DELETE FROM insta_comments WHERE id=?", (cid,), commit=True)
        return jsonify(ok=True)

    # ------------------------------------------------------------------ profiles / follow
    def counts(name):
        c = lambda sql: int(q(sql, (name,), one=True)["c"])
        return {"posts": c("SELECT COUNT(*) c FROM insta_posts WHERE username=?"),
                "followers": c("SELECT COUNT(*) c FROM insta_follows WHERE followee=? AND status='accepted'"),
                "following": c("SELECT COUNT(*) c FROM insta_follows WHERE follower=? AND status='accepted'")}

    def follow_state(me, other):
        r = q("SELECT status FROM insta_follows WHERE follower=? AND followee=?", (me, other), one=True)
        return ("following" if r["status"] == "accepted" else "requested") if r else "none"

    @app.route("/api/insta/profile/<username>")
    @api_login
    def insta_profile(username):
        me = session["insta_username"]
        users = insta_users()
        u = users.get(username)
        if not u or username == BOT_USER or (username != me and (is_blocked(users, username, me) or is_blocked(users, me, username))):
            return err("کاربر پیدا نشد.", 404)
        fol = following_of(me)
        visible = can_view(me, username, users, fol)
        pub = u
        info = {"username": pub["username"], "display_name": pub["display_name"], "bio": pub["bio"], "avatar": pub["avatar"],
                "avatar_url": pub["avatar_url"], "premium": False, "private_account": pub["private_account"]}
        resp = {"ok": True, "user": info, "is_me": username == me, "counts": counts(username), "visible": visible,
                "follow": "self" if username == me else follow_state(me, username),
                "follows_me": bool(q("SELECT 1 FROM insta_follows WHERE follower=? AND followee=? AND status='accepted'",
                                     (username, me), one=True)), "posts": [], "has_more": False, "next": None}
        if visible:
            rows = q("SELECT * FROM insta_posts WHERE username=? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
                     (username, before_arg(), GRID + 1))
            more = len(rows) > GRID
            rows = rows[:GRID]
            resp.update(posts=shape_posts(rows, me, users), has_more=more, next=float(rows[-1]["created_at"]) if rows else None)
        return jsonify(resp)

    @app.route("/api/insta/user/<username>/posts")
    @api_login
    def insta_user_posts(username):
        me = session["insta_username"]
        users = insta_users()
        if not can_view(me, username, users, following_of(me)):
            return jsonify(ok=True, posts=[], has_more=False, next=None)
        rows = q("SELECT * FROM insta_posts WHERE username=? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
                 (username, before_arg(), GRID + 1))
        return page_response(rows, GRID, me, users)

    @app.route("/api/insta/follow/<username>", methods=["POST"])
    @api_login
    def insta_follow(username):
        me = session["insta_username"]
        users = insta_users()
        if username == me or username not in users or username == BOT_USER:
            return err("کاربر پیدا نشد.", 404)
        if is_blocked(users, username, me) or is_blocked(users, me, username):
            return err("امکان دنبال کردن این کاربر وجود ندارد.", 403)
        want = bool((request.get_json(silent=True) or {}).get("follow", True))
        if want:
            if not rate_ok("insta_follow:" + me, 40, 60):
                return err("کمی آهسته‌تر.", 429)
            status = "pending" if users[username].get("private_account") else "accepted"
            q("INSERT INTO insta_follows(follower, followee, status, created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
              (me, username, status, time.time()), commit=True)
        else:
            q("DELETE FROM insta_follows WHERE follower=? AND followee=?", (me, username), commit=True)
        return jsonify(ok=True, follow=follow_state(me, username), counts=counts(username))

    @app.route("/api/insta/follows/<username>")
    @api_login
    def insta_follow_list(username):
        me = session["insta_username"]
        users = insta_users()
        fol = following_of(me)
        if not can_view(me, username, users, fol):
            return err("این حساب خصوصی است.", 403)
        kind = request.args.get("type", "followers")
        if kind == "following":
            rows = q("SELECT followee AS n FROM insta_follows WHERE follower=? AND status='accepted' ORDER BY created_at DESC LIMIT 300", (username,))
        else:
            rows = q("SELECT follower AS n FROM insta_follows WHERE followee=? AND status='accepted' ORDER BY created_at DESC LIMIT 300", (username,))
        out = []
        for r in rows:
            n = r["n"]
            if n in users and n != BOT_USER and not (is_blocked(users, n, me) or is_blocked(users, me, n)):
                d = mini(users[n])
                d["follow"] = "self" if n == me else ("following" if n in fol else follow_state(me, n))
                out.append(d)
        return jsonify(ok=True, users=out)

    @app.route("/api/insta/search")
    @api_login
    def insta_search():
        me = session["insta_username"]
        s = request.args.get("q", "").strip().lower().lstrip("@")
        if not s:
            return jsonify(ok=True, users=[])
        users = insta_users()
        out = []
        for n, u in users.items():
            if n in (me, BOT_USER) or is_blocked(users, n, me) or is_blocked(users, me, n):
                continue
            if s in n.lower() or s in str(u.get("display_name", "")).lower():
                if u.get("searchable", True) is False and n.lower() != s:
                    continue
                d = mini(u)
                d["follow"] = follow_state(me, n)
                out.append(d)
            if len(out) >= 25:
                break
        return jsonify(ok=True, users=out)

    # ------------------------------------------------------------------ activity (heart tab)
    @app.route("/api/insta/activity")
    @api_login
    def insta_activity():
        me = session["insta_username"]
        users = insta_users()
        ok = lambda n: n in users and n != me and not (is_blocked(users, n, me) or is_blocked(users, me, n))
        requests_ = [mini(users[r["follower"]]) for r in q(
            "SELECT follower FROM insta_follows WHERE followee=? AND status='pending' ORDER BY created_at DESC LIMIT 100", (me,))
            if ok(r["follower"])]
        ev = []
        for r in q("SELECT l.post_id, l.username, l.created_at, p.media_url, p.media_type FROM insta_likes l "
                   "JOIN insta_posts p ON p.id = l.post_id WHERE p.username=? AND l.username<>? "
                   "ORDER BY l.created_at DESC LIMIT 30", (me, me)):
            if ok(r["username"]):
                ev.append({"type": "like", "user": mini(users[r["username"]]), "post_id": r["post_id"],
                           "thumb": r["media_url"], "thumb_type": r["media_type"], "at": float(r["created_at"])})
        for r in q("SELECT c.post_id, c.username, c.text, c.created_at, p.media_url, p.media_type FROM insta_comments c "
                   "JOIN insta_posts p ON p.id = c.post_id WHERE p.username=? AND c.username<>? "
                   "ORDER BY c.created_at DESC LIMIT 30", (me, me)):
            if ok(r["username"]):
                ev.append({"type": "comment", "user": mini(users[r["username"]]), "post_id": r["post_id"], "text": r["text"][:120],
                           "thumb": r["media_url"], "thumb_type": r["media_type"], "at": float(r["created_at"])})
        for r in q("SELECT follower, created_at FROM insta_follows WHERE followee=? AND status='accepted' "
                   "ORDER BY created_at DESC LIMIT 20", (me,)):
            if ok(r["follower"]):
                ev.append({"type": "follow", "user": mini(users[r["follower"]]), "at": float(r["created_at"])})
        ev.sort(key=lambda e: -e["at"])
        return jsonify(ok=True, requests=requests_, events=ev[:40])

    @app.route("/api/insta/requests/<username>", methods=["POST"])
    @api_login
    def insta_request_answer(username):
        me = session["insta_username"]
        accept = bool((request.get_json(silent=True) or {}).get("accept", True))
        r = q("SELECT 1 FROM insta_follows WHERE follower=? AND followee=? AND status='pending'", (username, me), one=True)
        if not r:
            return err("درخواستی پیدا نشد.", 404)
        if accept:
            q("UPDATE insta_follows SET status='accepted' WHERE follower=? AND followee=?", (username, me), commit=True)
        else:
            q("DELETE FROM insta_follows WHERE follower=? AND followee=?", (username, me), commit=True)
        return jsonify(ok=True)

    # ------------------------------------------------------------------ Insta-only direct messages (separate tables from Chatroom)
    @app.route("/api/insta/dm", methods=["POST"])
    @api_login
    def insta_dm_create():
        me=session["insta_username"]; other=str((request.get_json(silent=True) or {}).get("username", "")).strip().lower(); users=insta_users()
        if other not in users or other==me:return err("کاربر پیدا نشد.",404)
        a,b=sorted((me,other)); key=a+"\x1f"+b
        row=q("SELECT id FROM insta_dm_threads WHERE pair_key=?",(key,),one=True)
        if not row:
            tid=uuid.uuid4().hex[:20];q("INSERT INTO insta_dm_threads(id,pair_key,user1,user2,created_at) VALUES(?,?,?,?,?)",(tid,key,a,b,time.time()),commit=True)
        else:tid=row["id"]
        return jsonify(ok=True,id=tid,user=mini(users[other]))

    @app.route("/api/insta/inbox")
    @api_login
    def insta_inbox():
        me=session["insta_username"];users=insta_users();rows=q("SELECT * FROM insta_dm_threads WHERE user1=? OR user2=? ORDER BY created_at DESC",(me,me));out=[]
        for t in rows:
            other=t["user2"] if t["user1"]==me else t["user1"]
            if other not in users:continue
            last=q("SELECT text,username,seq,created_at FROM insta_dm_messages WHERE thread_id=? ORDER BY seq DESC LIMIT 1",(t["id"],),one=True)
            out.append({"id":t["id"],"user":mini(users[other]),"last":last["text"] if last else "","last_by_me":bool(last and last["username"]==me),"seq":float(last["seq"]) if last else 0,"created_at":last["created_at"] if last else t["created_at"]})
        return jsonify(ok=True,chats=out)

    @app.route("/api/insta/messages", methods=["GET","POST"])
    @api_login
    def insta_messages():
        me=session["insta_username"];gid=request.args.get("group_id") if request.method=="GET" else str((request.get_json(silent=True) or {}).get("group_id", ""))
        t=q("SELECT * FROM insta_dm_threads WHERE id=? AND (user1=? OR user2=?)",(gid,me,me),one=True)
        if not t:return err("گفتگو پیدا نشد.",404)
        if request.method=="POST":
            msg=str((request.get_json(silent=True) or {}).get("text", "")).strip()[:4000]
            if not msg:return err("پیام خالی است.")
            now=time.time();mid=uuid.uuid4().hex[:20]
            q("INSERT INTO insta_dm_messages(id,thread_id,username,text,seq,created_at) VALUES(?,?,?,?,?,?)",(mid,gid,me,msg,now,now),commit=True)
        after=request.args.get("after",type=float) or 0
        rows=q("SELECT * FROM insta_dm_messages WHERE thread_id=? AND seq>? ORDER BY seq LIMIT 300",(gid,after))
        from datetime import datetime
        messages=[{"id":r["id"],"username":r["username"],"text":r["text"],"seq":float(r["seq"]),"created_at":datetime.fromtimestamp(float(r["created_at"])).isoformat(),"attach":None} for r in rows]
        return jsonify(ok=True,messages=messages,message=(messages[-1] if request.method=="POST" and messages else None))
