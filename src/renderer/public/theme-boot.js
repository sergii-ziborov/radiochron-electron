// Apply the saved theme to <html> before the first paint.
//
// A separate file rather than an inline script on purpose: the renderer's
// Content-Security-Policy is script-src 'self' with no unsafe-inline, and
// avoiding a one-frame flash is not worth widening it. Settings on disk remain
// the durable source of truth; this only prevents the flash while they load.
(function () {
  var KEY = 'radiochron.theme.v1';
  var VALID = ['radiochron', 'light', 'dark', 'night-city', 'cyberpunk', 'deus-ex'];
  try {
    var saved = localStorage.getItem(KEY);
    if (saved && VALID.indexOf(saved) >= 0) {
      document.documentElement.dataset.theme = saved;
    }
  } catch (error) {
    // A locked profile simply gets the default theme.
  }
})();
