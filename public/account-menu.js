const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function accountMenu(user, { personal = false } = {}) {
  if (!user) return '<a class="button primary small" href="#personal" data-account-link><span>Sign in</span></a>';
  return `<details class="account-menu"><summary aria-label="Account menu"><span class="avatar" aria-hidden="true">${escapeHtml((user.name || user.email || '?').charAt(0).toUpperCase())}</span><span>Account</span><span aria-hidden="true">⌄</span></summary><div class="account-menu-panel"><p class="account-menu-identity"><strong>${escapeHtml(user.name || 'Your account')}</strong><small>${escapeHtml(user.email || '')}</small></p><a href="#personal?page=profile">Profile</a><a href="#personal?page=settings">Settings</a><a href="#personal?page=sessions">My sessions</a><button type="button" ${personal ? 'data-sign-out' : 'data-public-sign-out'}>Sign out</button></div></details>`;
}

export function bindAccountMenus() {
  document.addEventListener('click', (event) => {
    document.querySelectorAll('.account-menu[open]').forEach((menu) => {
      if (!menu.contains(event.target) || event.target.closest('a')) menu.open = false;
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.account-menu[open]').forEach((menu) => {
      menu.open = false;
      menu.querySelector('summary').focus();
      event.preventDefault();
    });
  });
}
