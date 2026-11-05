Chatroom update
===============

Files:
- app.py: preserved unchanged. Its existing "/" route redirects authenticated
  users to /chat and keeps the login flow for visitors who are not signed in.
- chat.html: removed the sidebar-header close (X) button and moved the
  three-dot menu next to the Chatroom title.
- chat-nav.css: added narrowly scoped Chatroom header layout rules.
- chat-nav.js: preserved unchanged.

Insta Mode:
- Existing explicit /insta links remain user-triggered.
- This patch does not redirect users to Insta Mode or merge its page styling
  with Chatroom. The Insta implementation itself was not among the uploaded
  files, so its internal templates/styles were not modified.

Deployment:
Replace the matching files in the project. Keep the same paths and names.
