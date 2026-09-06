const toast = document.querySelector('.toast');
const showToast = (message) => { toast.textContent = message; toast.classList.add('show'); clearTimeout(window.__toast); window.__toast = setTimeout(() => toast.classList.remove('show'), 2600); };
document.querySelector('[data-windows-download]').addEventListener('click', () => showToast('Windows 安装包正在准备中，首个公开版本会在这里提供。'));
document.querySelector('[data-mac-download]').addEventListener('click', (event) => { if (event.currentTarget.getAttribute('href') === '#download') { event.preventDefault(); showToast('macOS 安装包正在准备中，发布后可在这里下载。'); } });
const menu = document.querySelector('.menu-toggle'); const nav = document.querySelector('.nav-links');
menu.setAttribute('aria-expanded', 'false');
menu.addEventListener('click', () => menu.setAttribute('aria-expanded', String(nav.classList.toggle('open'))));
nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => nav.classList.remove('open')));
const platform = navigator.userAgent.toLowerCase();
if (platform.includes('win')) document.querySelector('[data-primary-download]').textContent = '获取 Windows 版本 →';
nav.addEventListener('click', () => menu.setAttribute('aria-expanded', 'false'));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && nav.classList.contains('open')) {
    nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); menu.focus();
  }
});
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const stage = document.querySelector('.orb-stage');
const motionButton = document.createElement('button');
motionButton.className = 'motion-toggle';
stage.append(motionButton);
let paused = reducedMotion.matches;
function updateMotion() {
  document.body.classList.toggle('motion-paused', paused);
  motionButton.textContent = paused ? '播放动效 ↗' : '暂停动效 Ⅱ';
  motionButton.setAttribute('aria-label', paused ? '播放页面动效' : '暂停页面动效');
}
motionButton.addEventListener('click', () => { paused = !paused; updateMotion(); });
reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; updateMotion(); });
updateMotion();
const wave = document.createElement('div');
wave.className = 'waveform';
wave.setAttribute('aria-hidden', 'true');
for (let i = 0; i < 15; i++) {
  const bar = document.createElement('i');
  bar.style.setProperty('--delay', (i * -.13) + 's');
  bar.style.height = (10 + (7 - Math.abs(7 - i)) * 3) + 'px';
  wave.append(bar);
}
stage.append(wave);
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
  }), { threshold: .08 });
  document.querySelectorAll('.section-heading, .feature-grid article, .steps > div, .privacy-card, .download-card').forEach(element => {
    element.style.setProperty('--reveal-delay', Math.min([...element.parentElement.children].indexOf(element), 3) * 75 + 'ms');
    element.classList.add('reveal'); observer.observe(element);
  });
}
const header = document.querySelector('.site-header');
const sections = [...document.querySelectorAll('main > section[id]')];
let frame = 0;
function updateScroll() {
  frame = 0;
  header.classList.toggle('scrolled', scrollY > 20);
  let active = '';
  sections.forEach(section => { if (section.getBoundingClientRect().top < innerHeight * .42) active = section.id; });
  nav.querySelectorAll('a').forEach(link => {
    if (link.hash === '#' + active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(updateScroll); }, { passive: true });
updateScroll();
stage.addEventListener('pointermove', event => {
  if (paused || event.pointerType !== 'mouse') return;
  const rect = stage.getBoundingClientRect();
  stage.style.setProperty('--x', ((event.clientX - rect.left - rect.width / 2) * .025) + 'px');
  stage.style.setProperty('--y', ((event.clientY - rect.top - rect.height / 2) * .025) + 'px');
});
stage.addEventListener('pointerleave', () => { stage.style.setProperty('--x', '0px'); stage.style.setProperty('--y', '0px'); });
