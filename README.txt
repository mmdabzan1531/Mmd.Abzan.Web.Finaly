Insta Mode - نصب (۴ مرحله)

1) این فایل‌ها را در ریپو بگذار:
   insta.py              -> کنار app.py (ریشه)
   templates/insta.html  -> داخل پوشه templates
   templates/chat.html   -> جایگزین قبلی (فقط یک دکمه به منوی کناری اضافه شده)
   static/insta.css      -> داخل پوشه static
   static/insta.js       -> داخل پوشه static

2) آخر فایل app.py (خط آخر، بعد از api_polls) این دو خط را اضافه کن:

   import insta
   insta.register(globals())

3) Deploy کن. جدول‌ها خودکار ساخته می‌شوند (SQLite یا Postgres).

4) در چت، منوی کناری > Insta Mode  (یا مستقیم آدرس /insta)
