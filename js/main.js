/* SatisBall — boot. */
'use strict';
(function (SB) {
  SB.engine = new SB.audio.Engine();
  // Fonts are embedded (data URIs) but only decode on first use: load them before any canvas text.
  SB.fontsReady = Promise.all([
    "900 80px Unbounded", "700 80px Unbounded", "500 20px 'Space Grotesk'", "700 20px 'Space Grotesk'",
  ].map((f) => document.fonts.load(f))).catch(() => {});
  window.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(location.search).has('headless')) return; // test harness
    SB.fontsReady.then(() => { SB.app = new SB.UI(document.getElementById('app')); });
  });
})(window.SB);
