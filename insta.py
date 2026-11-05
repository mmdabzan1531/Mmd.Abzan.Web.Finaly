# -*- coding: utf-8 -*-
"""
Insta Mode backend  (posts, reels, likes, comments, saves, follows, explore, activity, DM inbox).

Hooked into app.py with ONE line at the very end of that file:

    import insta; insta.register(globals())

It reuses everything that already exists in app.py: users.json, sessions, /media storage,
stories (/api/stories), and the DM system (/api/dm, /api/messages, /api/upload).
New data lives in 5 small SQL tables (works on SQLite and on Postgres/DATABASE_URL).
"""
import os, re, time, uuid

from flask import request, session, jsonify, render_template, redirect, url_for


def register(g):
    app = g["app"]
    q = g["q"]
    read_json = g["read_json"]
    USERS_FILE = g["USERS_FILE"]
    api_login = g["api_login"]
    logged_in = g["logged_in"]
    safe_user_public = g["safe_user_public"]
    is_blocked = g["is_blocked"]
    store_media = g["store_media"]
    remove_media_url = g["remove_media_url"]
    looks_like_image = g["looks_like_image"]
    clean_filename = g["clean_filename"]
    file_ext = g["file_ext"]
    rate_ok = g["rate_ok"]
    my_groups = g["my_groups"]
    BOT_USER = g["BOT_USER"]
    IMAGE_MIME = g["IMAGE_MIME"]
    VIDEO_MIME = g["VIDEO_MIME"]
    MAX_FILE_SIZE = g["MAX_FILE_SIZE"]
    MAX_FILE_MB = g["MAX_FILE_MB"]
    MAX_IMAGE_SIZE = g["MAX_IMAGE_SIZE"]

    PAGE = 12
    GRID = 30

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
        p = safe_user_public(u)
        return {"username": p["username"], "display_name": p["display_name"], "avatar": p["avatar"],
                "avatar_url": p["avatar_url"], "premium": p["premium"], "private_account": p["private_account"]}

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
        users = read_json(USERS_FILE, {})
        if not can_view(me, r["username"], users, following_of(me)):
            return None
        return r

    def before_arg():
        v = request.args.get("before", type=float)
        return v if v else time.time() + 5

    # ------------------------------------------------------------------ page
    @app.route("/insta")
    @logged_in
    def insta_page():
        users = read_json(USERS_FILE, {})
        username = session["username"]
        if username not in users:
            session.clear()
            return redirect(url_for("index"))
        return render_template("insta.html", current_user=safe_user_public(users[username], True))

    # ------------------------------------------------------------------ feeds
    @app.route("/api/insta/feed")
    @api_login
    def insta_feed():
        me = session["username"]
        users = read_json(USERS_FILE, {})
        fol = following_of(me)
        hid = hidden_users(me, users, fol)
        names = [n for n in ({me} | fol) if n in users and n not in hid]
        rows = q(f"SELECT * FROM insta_posts WHERE username IN ({ph(len(names))}) AND created_at < ? "
                 "ORDER BY created_at DESC LIMIT ?", tuple(names) + (before_arg(), PAGE + 1))
        return page_response(rows, PAGE, me, users)

    def open_feed(extra_sql, extra_args, limit):
        me = session["username"]
        users = read_json(USERS_FILE, {})
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
        me = session["username"]
        users = read_json(USERS_FILE, {})
        fol = following_of(me)
        rows = q("SELECT p.* FROM insta_posts p JOIN insta_saves s ON s.post_id = p.id WHERE s.username=? "
                 "ORDER BY s.created_at DESC LIMIT 200", (me,))
        rows = [r for r in rows if can_view(me, r["username"], users, fol)]
        return jsonify(ok=True, posts=shape_posts(rows, me, users), has_more=False)

    # ------------------------------------------------------------------ create / read / delete post
    @app.route("/api/insta/posts", methods=["POST"])
    @api_login
    def insta_create():
        me = session["username"]
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
        users = read_json(USERS_FILE, {})
        post = shape_posts([q("SELECT * FROM insta_posts WHERE id=?", (pid,), one=True)], me, users)[0]
        return jsonify(ok=True, post=post)

    @app.route("/api/insta/posts/<pid>")
    @api_login
    def insta_post(pid):
        me = session["username"]
        r = get_visible_post(pid, me)
        if not r:
            return err("پست پیدا نشد.", 404)
        return jsonify(ok=True, post=shape_posts([r], me, read_json(USERS_FILE, {}))[0])

    @app.route("/api/insta/posts/<pid>", methods=["DELETE"])
    @api_login
    def insta_delete(pid):
        me = session["username"]
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
        me = session["username"]
        r = q("SELECT username FROM insta_posts WHERE id=?", (pid,), one=True)
        if not r or r["username"] != me:
            return err("پست پیدا نشد.", 404)
        cap = str((request.get_json(silent=True) or {}).get("caption", "")).strip()[:2200]
        q("UPDATE insta_posts SET caption=? WHERE id=?", (cap, pid), commit=True)
        return jsonify(ok=True, caption=cap)

    # ------------------------------------------------------------------ like / save
    def toggle(table, pid):
        me = session["username"]
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
        me = session["username"]
        post = get_visible_post(pid, me)
        if not post:
            return err("پست پیدا نشد.", 404)
        users = read_json(USERS_FILE, {})
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
        me = session["username"]
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
        me = session["username"]
        users = read_json(USERS_FILE, {})
        u = users.get(username)
        if not u or username == BOT_USER or (username != me and (is_blocked(users, username, me) or is_blocked(users, me, username))):
            return err("کاربر پیدا نشد.", 404)
        fol = following_of(me)
        visible = can_view(me, username, users, fol)
        pub = safe_user_public(u, full=(username == me))
        info = {"username": pub["username"], "display_name": pub["display_name"], "bio": pub["bio"], "avatar": pub["avatar"],
                "avatar_url": pub["avatar_url"], "premium": pub["premium"], "private_account": pub["private_account"]}
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
        me = session["username"]
        users = read_json(USERS_FILE, {})
        if not can_view(me, username, users, following_of(me)):
            return jsonify(ok=True, posts=[], has_more=False, next=None)
        rows = q("SELECT * FROM insta_posts WHERE username=? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
                 (username, before_arg(), GRID + 1))
        return page_response(rows, GRID, me, users)

    @app.route("/api/insta/follow/<username>", methods=["POST"])
    @api_login
    def insta_follow(username):
        me = session["username"]
        users = read_json(USERS_FILE, {})
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
        me = session["username"]
        users = read_json(USERS_FILE, {})
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
        me = session["username"]
        s = request.args.get("q", "").strip().lower().lstrip("@")
        if not s:
            return jsonify(ok=True, users=[])
        users = read_json(USERS_FILE, {})
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
        me = session["username"]
        users = read_json(USERS_FILE, {})
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
        me = session["username"]
        accept = bool((request.get_json(silent=True) or {}).get("accept", True))
        r = q("SELECT 1 FROM insta_follows WHERE follower=? AND followee=? AND status='pending'", (username, me), one=True)
        if not r:
            return err("درخواستی پیدا نشد.", 404)
        if accept:
            q("UPDATE insta_follows SET status='accepted' WHERE follower=? AND followee=?", (username, me), commit=True)
        else:
            q("DELETE FROM insta_follows WHERE follower=? AND followee=?", (username, me), commit=True)
        return jsonify(ok=True)

    # ------------------------------------------------------------------ DM inbox (uses the existing chat system)
    @app.route("/api/insta/inbox")
    @api_login
    def insta_inbox():
        me = session["username"]
        users = read_json(USERS_FILE, {})
        out = []
        for gid, grp in my_groups(me).items():
            if grp.get("type") != "dm":
                continue
            other = next((m for m in grp.get("members", []) if m != me), None)
            if not other or other not in users:
                continue
            last = grp.get("last") or {}
            out.append({"id": gid, "user": mini(users[other]), "last": last.get("text", ""),
                        "last_by_me": last.get("username") == me, "seq": last.get("seq", 0), "created_at": last.get("created_at", "")})
        out.sort(key=lambda d: -(d["seq"] or 0))
        return jsonify(ok=True, chats=out)
