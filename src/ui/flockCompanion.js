import { escapeHtml } from './html.js';
import { localToday } from '../services/calculations.js';
import { STAGE_LABEL, userDisplayName } from '../services/flockCompanion.js';

export function companionArt(mascot, extraClass = '') {
  const stage = mascot?.stage || 'chick';
  const mood = mascot?.mood || 'happy';
  const asset = ({calm:'sleepy',tired:'annoyed'})[mood] || mood;
  return `<img class="companion-art companion-${stage} mood-${asset} ${extraClass}" src="/images/chickens/chicken-${asset}.svg" width="280" height="280" alt="${STAGE_LABEL[stage]}, ${asset}"/>`;
}

export function renderCompanion(mascot, items, { staff = false, financialHtml = '' } = {}) {
  const labels = {alerted:'Something needs a look.',annoyed:'Let’s catch up',sad:'A little extra care',happy:'A good day for your flock',sleepy:'One step at a time'};
  const mood = staff && mascot.mood === 'sad' ? 'sleepy' : mascot.mood;
  const reason = staff && mascot.mood === 'sad' ? 'Your flock is taking it one day at a time.' : mascot.reason;
  const action = mood === 'alerted' ? 'Review alerts' : mood === 'sad' ? 'View recorded P&L' : 'View today’s tasks';
  const target = mood === 'alerted' ? 'home:health' : mood === 'sad' ? 'reports:summaries' : 'home:todo';
  return `<section class="flock-companion rd-companion" aria-labelledby="companion-title" data-mood="${mood}">
    <button type="button" class="companion-touch" id="btn-greet-flock" aria-label="Say hello to your chicken">${companionArt({...mascot,mood})}<span class="companion-touch-hint">Tap to say hello</span></button>
    <div class="rd-companion-copy"><span class="rd-pill ${mood === 'alerted'?'urgent':mood==='happy'?'good':mood==='sad'?'info':'watch'}">${mood[0].toUpperCase()+mood.slice(1)}</span><h2 id="companion-title">${labels[mood] || 'Growing with you'}</h2><p id="companion-message" aria-live="polite">${escapeHtml(reason)}</p><div class="rd-action-row rd-companion-cta"><button type="button" class="btn-action primary" data-nav="nav:${target}">${action}</button></div>${financialHtml}</div>
  </section>`;
}

export function renderWelcome(user, summary = {}) {
  return `<section class="welcome-screen" id="flock-welcome" aria-labelledby="welcome-title"><div class="welcome-card">
    <div class="welcome-wordmark">Chick<span>Pence</span><i>.</i></div>
    <h1 id="welcome-title">Hi, ${escapeHtml(userDisplayName(user))}.</h1><p>Let's start a good day.</p><div class="rd-welcome-chips"><span>${summary.alerts || 0} alerts</span><span>${summary.tasks || 0} tasks due</span><span>${summary.questions || 0} new insights</span></div>
    <button type="button" class="welcome-character" id="welcome-hello" aria-label="Say hello to your welcome chicken"><span class="welcome-bubble">You're all set!<br>Your flock is waiting.</span>${companionArt({stage:'ready',mood:'hello'})}</button>
    <button class="welcome-enter" id="btn-enter-flock" type="button"><svg width="30" height="40" viewBox="0 0 30 40" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 2v32M4 23l11 12 11-12"/></svg><span>Discover your flock's day</span><small>Scroll down or tap to begin</small></button>
  </div></section>`;
}

let welcomeCleanup;
export function attachWelcome(container) {
  welcomeCleanup?.();
  const welcome = container.querySelector('#flock-welcome');
  const dashboard = container.querySelector('.cp-app');
  if (!welcome || !dashboard) return;
  container.querySelector('#welcome-hello')?.addEventListener('click',e=>{const button=e.currentTarget;button.classList.remove('is-greeting');requestAnimationFrame(()=>button.classList.add('is-greeting'));button.querySelector('.welcome-bubble').textContent='A little care makes a good day. Ready when you are!';});
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scroll = () => {
    const progress = Math.max(0, Math.min(1, -welcome.getBoundingClientRect().top / (welcome.offsetHeight * .8)));
    welcome.style.setProperty('--welcome-fade', reduce ? '1' : String(1 - progress));
  };
  container.querySelector('#btn-enter-flock')?.addEventListener('click', () => {
    dashboard.scrollIntoView({behavior:reduce ? 'instant' : 'smooth',block:'start'});
    dashboard.setAttribute('tabindex', '-1');
    dashboard.focus({preventScroll:true});
  });
  window.addEventListener('scroll', scroll, {passive:true});
  welcomeCleanup = () => window.removeEventListener('scroll', scroll);
  scroll();
}


export function attachCompanion(container, onBatchChange) {
  const hello = container.querySelector('#btn-greet-flock');
  const message = container.querySelector('#companion-message');
  const originalMessage = message?.textContent;
  let greetingTimer;
  hello?.addEventListener('click', () => {
    hello.classList.remove('is-greeting');
    requestAnimationFrame(() => hello.classList.add('is-greeting'));
    if (message) message.textContent = "Hello, flock keeper! Let's make today a little better.";
    clearTimeout(greetingTimer);
    greetingTimer = setTimeout(() => { if (message?.isConnected) message.textContent = originalMessage; }, 2400);
  });
  hello?.addEventListener('animationend', () => hello.classList.remove('is-greeting'));
  container.querySelector('#companion-batch')?.addEventListener('change', e => onBatchChange(e.target.value));
}
