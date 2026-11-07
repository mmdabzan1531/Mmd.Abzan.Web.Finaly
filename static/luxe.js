/* luxe.js — tiny, optional: cursor-follow highlight on cards, haptic tick on primary buttons. */
(function(){
  var fine=matchMedia&&matchMedia("(hover:hover) and (pointer:fine)").matches;
  if(fine)document.addEventListener("pointermove",function(e){
    var c=e.target.closest&&e.target.closest(".ig-card");if(!c)return;
    var r=c.getBoundingClientRect();c.style.setProperty("--mx",(e.clientX-r.left)+"px");c.style.setProperty("--my",(e.clientY-r.top)+"px");
  },{passive:true});
  document.addEventListener("click",function(e){
    if(navigator.vibrate&&e.target.closest&&e.target.closest(".ig-btn,.key.hot"))navigator.vibrate(8);
  },{passive:true});
})();
