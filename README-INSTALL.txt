Insta Mode bottom navigation update

Files:
- chat.html: adds the fifth Insta Mode tab and removes the floating Insta launcher.
- chat-nav.css: styles the five-tab bottom navigation (already linked by chat.html).
- chat-nav.js: wires the four existing chat controls and leaves Insta Mode as a normal link to /insta.

Install:
1. Replace templates/chat.html with chat.html.
2. Put chat-nav.css and chat-nav.js in static/.
3. app.py already contains `import insta` and `insta.register(globals())`; no backend change is needed.
4. Ensure templates/insta.html, static/insta.css, static/insta.js, and insta.py are installed as described in your existing README.
