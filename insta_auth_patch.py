# ---------- Insta accounts (separate from Chatroom accounts) ----------
INSTA_USERS_FILE = os.path.join(DATA_DIR, "insta_users.json")
INSTA_USER_RE = re.compile(r"[A-Za-z0-9_.]{3,30}")


def _insta_text(p, key, limit):
    """Only real text or numbers are accepted (no bool/list/dict); returns None when the type is wrong."""
    v = p.get(key)
    if v is None:
        return ""
    if isinstance(v, bool) or not isinstance(v, (str, int)):
        return None
    return str(v)[:limit] if limit else str(v)


@app.route("/api/insta/auth/register", methods=["POST"])
def insta_register():
    p = request.get_json(silent=True)
    if not isinstance(p, dict):
        return jsonify(error="درخواست نامعتبر است."), 400
    name, username, contact, password = (_insta_text(p, "display_name", 200), _insta_text(p, "username", 200),
                                         _insta_text(p, "contact", 200), _insta_text(p, "password", 0))
    if None in (name, username, contact, password):
        return jsonify(error="مقدار یکی از فیلدها معتبر نیست."), 400
    name, username = name.strip(), username.strip()
    if not name:
        return jsonify(error="نام نمایشی را وارد کن."), 400
    if len(name) > 60:
        return jsonify(error="نام نمایشی نباید بیشتر از ۶۰ کاراکتر باشد."), 400
    if not INSTA_USER_RE.fullmatch(username) or username[0] == "." or username[-1] == "." or ".." in username:
        return jsonify(error="نام کاربری باید ۳ تا ۳۰ حرف انگلیسی، عدد، _ یا نقطه باشد (بدون شروع/پایان با نقطه)."), 400
    email, phone, err = parse_contact(contact)
    if err:
        return jsonify(error=err), 400
    if len(password) < 8:
        return jsonify(error="رمز عبور باید حداقل ۸ کاراکتر باشد."), 400
    if len(password) > 128:
        return jsonify(error="رمز عبور نباید بیشتر از ۱۲۸ کاراکتر باشد."), 400
    if password.lower() == username.lower():
        return jsonify(error="رمز عبور نباید با نام کاربری یکی باشد."), 400
    if not rate_ok("ig-su:" + client_ip(), 10, 600):
        return jsonify(error="تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کن."), 429
    with data_lock:
        users = read_json(INSTA_USERS_FILE, {})
        if any(n.lower() == username.lower() for n in users):
            return jsonify(error="این نام کاربری قبلاً گرفته شده است."), 409
        if email and any(u.get("email") == email for u in users.values()):
            return jsonify(error="با این ایمیل قبلاً حساب ساخته شده است."), 409
        if phone and any(u.get("phone") == phone for u in users.values()):
            return jsonify(error="با این شماره قبلاً حساب ساخته شده است."), 409
        users[username] = {"username": username, "display_name": name, "email": email, "phone": phone,
                           "password_hash": generate_password_hash(password),
                           "created_at": datetime.now(timezone.utc).isoformat()}
        write_json(INSTA_USERS_FILE, users)
    # no auto-login: the person signs in on purpose
    return jsonify(ok=True, registered=True, message="حساب ساخته شد. حالا وارد شو.")


@app.route("/api/insta/auth/login", methods=["POST"])
def insta_login():
    p = request.get_json(silent=True)
    if not isinstance(p, dict):
        return jsonify(error="درخواست نامعتبر است."), 400
    ident, password = _insta_text(p, "login", 120), _insta_text(p, "password", 0)
    if ident is None or password is None:
        return jsonify(error="نام کاربری و رمز عبور را درست وارد کن."), 400
    ident = ident.strip()
    if not ident:
        return jsonify(error="نام کاربری، ایمیل یا شماره را وارد کن."), 400
    if not password:
        return jsonify(error="رمز عبور را وارد کن."), 400
    if len(password) > 256:
        return jsonify(error="رمز عبور خیلی طولانی است."), 400
    if not rate_ok("ig-ip:" + client_ip(), 120, 600) or not rate_ok("ig-login:" + client_ip() + ":" + ident.lower(), 8, 600):
        return jsonify(error="تعداد تلاش‌ها زیاد بود؛ چند دقیقه بعد دوباره امتحان کن."), 429
    users = read_json(INSTA_USERS_FILE, {})
    name = find_user(ident, users)
    good = bool(name) and check_password_hash(users[name].get("password_hash", ""), password)
    if not name:
        check_password_hash(_DUMMY_HASH, password)          # same timing whether or not the user exists
    if not good:
        return jsonify(error="نام کاربری یا رمز عبور درست نیست."), 401
    session["insta_username"] = name
    session.permanent = True
    return jsonify(ok=True, redirect="/insta")


@app.route("/api/insta/auth/logout", methods=["POST"])
def insta_logout():
    session.pop("insta_username", None)                      # the Chatroom session stays
    return jsonify(ok=True)


@app.route("/insta")
def insta_home():
    name = session.get("insta_username")
    if not name:
        return redirect(url_for("auth_page", section="insta"))
    users = read_json(INSTA_USERS_FILE, {})
    if name not in users:                                    # account was removed
        session.pop("insta_username", None)
        return redirect(url_for("auth_page", section="insta"))
    return render_template("insta.html", current_user={"username": name, "display_name": users[name].get("display_name", name)})
