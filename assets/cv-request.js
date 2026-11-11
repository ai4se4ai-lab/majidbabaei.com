'use strict';
// Email remains the fallback when JavaScript or native dialogs are unavailable.
(() => {
  const dialog = document.createElement('dialog');
  if (!dialog.showModal) return;
  dialog.id = 'cv-request-dialog';
  dialog.className = 'cv-request-dialog';
  dialog.setAttribute('aria-labelledby', 'cv-request-title');
  dialog.setAttribute('aria-describedby', 'cv-request-description');
  dialog.innerHTML = `<form method="dialog"><button class="cv-request-close" aria-label="Close CV request">&times;</button></form>
    <p class="cv-request-kicker">Curriculum vitae</p>
    <h2 id="cv-request-title">Request my latest CV</h2>
    <p id="cv-request-description">Interested in my background or research? Email me and I can share my latest CV.</p>
    <a class="cv-request-email" href="mailto:majid.babaei@ufv.ca?subject=Latest%20CV%20request">Email Majid Babaei</a>
    <p class="cv-request-address">majid.babaei@ufv.ca</p>`;
  document.body.append(dialog);
  let opener;
  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || !link.hasAttribute('data-cv-request') && !/\/[^/?#]*(?:Curriculum_Vitae|Majid_Babaei_CV)\.pdf(?:[?#]|$)/i.test(link.href)
      && !link.href.startsWith('mailto:majid.babaei@ufv.ca?subject=Latest%20CV')) return;
    if (dialog.contains(link)) return;
    event.preventDefault();
    opener = link;
    dialog.showModal();
    document.documentElement.classList.add('cv-request-open');
    dialog.querySelector('.cv-request-email').focus();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('cv-request-open');
    opener?.focus({ preventScroll: true });
  });
})();
