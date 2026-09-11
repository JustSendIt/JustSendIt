/* The gate is a modal now (invite.js), not a page. This only exists so a bookmarked or shared
   /gate.html still lands somewhere useful. The <meta http-equiv="refresh"> above does the work on its
   own; this replaces the history entry so Back does not bounce the visitor straight back here.
   CSP on this site is script-src 'self', so the redirect cannot be inline. */
location.replace('/?invite=1');
