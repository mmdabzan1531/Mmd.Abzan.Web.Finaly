/* Bottom navigation actions */
(function () {
  "use strict";
  var bar = document.getElementById("chat-bottom-nav");
  if (!bar) return;
  function clickFirst(ids) {
    for (var i=0;i<ids.length;i++) { var n=document.getElementById(ids[i]); if(n){n.click();return true;} }
    return false;
  }
  function setActive(key) {
    Array.prototype.forEach.call(bar.querySelectorAll("[data-chat-nav]"),function(item){
      var active=item.getAttribute("data-chat-nav")===key;
      item.classList.toggle("is-active",active);
      if(active)item.setAttribute("aria-current","page");else item.removeAttribute("aria-current");
    });
  }
  bar.addEventListener("click",function(event){
    var item=event.target.closest("[data-chat-nav]"); if(!item)return;
    var key=item.getAttribute("data-chat-nav"); if(key==="insta")return;
    event.preventDefault(); setActive(key);
    if(key==="chats") clickFirst(["open-sidebar"]);
    else if(key==="contacts"){
      clickFirst(["open-sidebar"]);
      window.setTimeout(function(){var search=document.getElementById("chat-search");if(search){search.focus();search.placeholder="جستجوی مخاطبین…";}},80);
    } else if(key==="settings") clickFirst(["open-settings"]);
    else if(key==="profile") clickFirst(["open-profile"]);
  });
  setActive("chats");
})();
