# ============================================================
#  پچ بک‌اند: پس‌زمینه‌ی مشترک گروه   (روی app.py خودتان اعمال کنید)
#  ۳ تغییر کوچک — بقیه‌ی فایل را دست نزنید
# ============================================================

# ------------------------------------------------------------------
# تغییر ۱) تابع public_group را پیدا کنید و کلید "background" را اضافه کنید:
# ------------------------------------------------------------------
def public_group(g):
    return {"name": g.get("name", "گروه"), "description": g.get("description", ""), "members": g.get("members", []),
            "owner": g.get("owner", ""), "admins": g.get("admins", []), "type": g.get("type", "group"),
            "avatar_url": g.get("avatar_url", ""),
            "background": g.get("background", "")}          # <<< جدید


# ------------------------------------------------------------------
# تغییر ۲) این endpoint جدید را درست قبل از  def _delete_group_data(...)  بگذارید
# ------------------------------------------------------------------
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


# ------------------------------------------------------------------
# تغییر ۳) (اختیاری ولی تمیز) تا با حذف گروه، عکس پس‌زمینه هم پاک شود:
#   - امضای تابع را این‌طور کنید:
#         def _delete_group_data(group_id, avatar_url="", background=""):
#   - آخر همان تابع، بعد از remove_media_url(avatar_url) این خط را اضافه کنید:
#         remove_media_url(background)
#   - و در دو جایی که صدایش می‌زنید (leave و delete) آرگومان سوم را بدهید:
#         _delete_group_data(group_id, g.get("avatar_url", ""), g.get("background", ""))
# ------------------------------------------------------------------
