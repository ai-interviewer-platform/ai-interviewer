const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function accountMenu(user, { personal = false } = {}) {
  if (!user) return '<a class="button primary small" href="#personal" data-account-link><span>Sign in</span></a>';
  return `<details class="account-menu"><summary aria-label="Account menu"><span class="avatar" aria-hidden="true">${escapeHtml((user.name || user.email || '?').charAt(0).toUpperCase())}</span><span>Account</span><svg class="account-menu-chevron" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg></summary><div class="account-menu-panel"><p class="account-menu-identity"><strong>${escapeHtml(user.name || 'Your account')}</strong><small>${escapeHtml(user.email || '')}</small></p><a href="#personal?page=profile">Profile</a><a href="#personal?page=sessions">My sessions</a><a href="#personal?page=settings">Settings</a><hr><button type="button" ${personal ? 'data-sign-out' : 'data-public-sign-out'}>Sign out</button></div></details>`;
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
