// MIT License © 2026 Carlos Lopez
// GitHub Pages serves 404.html for a path it does not know. A link that lost its
// folder (for example /#inksplat=... pasted after /something) still carries the
// invite in the fragment, so send the visitor to the viewer root and keep it.
// The root is this site's base path: everything before the first unknown segment.
(function () {
  var base = document.currentScript ? document.currentScript.getAttribute('data-base') : null;
  var target = (base || '/') + location.hash;
  if (location.hash.indexOf('inksplat=') !== -1) {
    location.replace(target);
  }
})();
