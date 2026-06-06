// ============================================================
//  NestIQ — Master Shared Logic (State & UI Sync)
// ============================================================
const NestState = (function(){
  function _r(key, fb){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):fb; }catch(e){ return fb; } }
  function _w(key,val){ try{ localStorage.setItem(key,JSON.stringify(val)); }catch(e){} }

  function setUser(u){ _w('user', u); syncGlobalAvatar(); } 
  
  function isLoggedIn() {
    // FIX: Token now lives in httpOnly cookie — check for user info only
    const savedUser = JSON.parse(localStorage.getItem('user'));
    return savedUser && savedUser._id ? true : false;
  }
  
  function getUser() { return JSON.parse(localStorage.getItem('user')); }
  
  async function clearUser() {
    // FIX: Call backend logout to clear the httpOnly cookie
    try {
      await fetch((window.API_BASE || '/api') + '/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch(e) {}
    localStorage.removeItem('user');
    localStorage.removeItem('nestiq_saved');
    window.location.href = 'index.html';
  }

  // --- Theme State ---
  function isDark() { return localStorage.getItem('nestiq_dark') === '1'; }
  function setDark(val) { localStorage.setItem('nestiq_dark', val ? '1' : '0'); }

  // --- Saved Properties State ---
  function getSaved() { return _r('nestiq_saved', []); }
  function isSaved(id) { return getSaved().includes(String(id)); }
  function addSaved(id) { const s = getSaved(); if(!s.includes(String(id))) { s.push(String(id)); _w('nestiq_saved', s); } }
  function removeSaved(id) { const s = getSaved().filter(x => x !== String(id)); _w('nestiq_saved', s); }

  // --- Recently Viewed State ---
  function getRecentIds() { return _r('nestiq_recent', []); }
  function trackView(id) {
    let r = getRecentIds().filter(x => x !== String(id));
    r.unshift(String(id));
    if(r.length > 8) r.pop();
    _w('nestiq_recent', r);
  }

  return { 
    setUser, isLoggedIn, getUser, clearUser, _r, _w, 
    isDark, setDark,
    getSaved, isSaved, addSaved, removeSaved,
    getRecentIds, trackView
  };
})();
// Expose to window for HTML access
window.setUser = NestState.setUser;
window.isLoggedIn = NestState.isLoggedIn;
window.getUser = NestState.getUser;
window.clearUser = NestState.clearUser;

// ── THE AVATAR SYNC ENGINE ────────────────────────────────────
function syncGlobalAvatar() {
  const user = window.getUser();
  if (user && user.token) {
    const avatarEls = document.querySelectorAll('.nav-user-avatar');
    avatarEls.forEach(el => {
      if (user.profilePicUrl) {
        el.innerHTML = `<img src="${user.profilePicUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.src='https://ui-avatars.com/api/?name=U'">`;
        el.style.background = 'transparent';
      } else {
        el.innerHTML = user.firstName ? user.firstName.charAt(0).toUpperCase() : 'U';
      }
    });
  }
}

window.addEventListener('load', syncGlobalAvatar);

window.getUser=NestState.getUser; window.setUser=NestState.setUser; window.clearUser=NestState.clearUser;
window.isLoggedIn=NestState.isLoggedIn; window.getSaved=NestState.getSaved; window.isSaved=NestState.isSaved;
window.addSaved=NestState.addSaved; window.removeSaved=NestState.removeSaved;
window.trackView=NestState.trackView; window.getRecentIds=NestState.getRecentIds;

// ── DARK MODE ─────────────────────────────────────────────────
(function(){ if(NestState.isDark()) document.documentElement.classList.add('dark'); })();
window.applyTheme=function(){ document.documentElement.classList.toggle('dark',NestState.isDark()); };
window.toggleDark=function(){
  const next=!NestState.isDark(); NestState.setDark(next);
  document.documentElement.classList.toggle('dark',next);
  document.querySelectorAll('.dark-toggle-icon').forEach(el=>{ el.textContent=next?'☀️':'🌙'; });
};


// ── CARD PLUGIN SYSTEM ────────────────────────────────────────
const NestCardPlugins=(function(){
  const _p=[];
  return { register:function(fn){ _p.push(fn); }, apply:function(html,p){ return _p.reduce((h,fn)=>fn(h,p),html); } };
})();
window.NestCardPlugins=NestCardPlugins;

// ── DOM READY ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{

  const navbar=document.getElementById('navbar');
  if(navbar) window.addEventListener('scroll',()=>navbar.classList.toggle('scrolled',window.scrollY>60),{passive:true});

  window.toggleMobile=function(){ document.getElementById('navbar')?.classList.toggle('nav-open'); };
  document.querySelectorAll('.nav-links a').forEach(a=>a.addEventListener('click',()=>document.getElementById('navbar')?.classList.remove('nav-open')));
  
  document.querySelectorAll('.dark-toggle-icon').forEach(el=>{ el.textContent=NestState.isDark()?'☀️':'🌙'; });
  
  if (window.updateNavAuth) window.updateNavAuth();
  if (window._setActiveNavLink) window._setActiveNavLink();
});

// ── NAV AUTH ──────────────────────────────────────────────────
window.updateNavAuth = function() {
  const user = NestState.getUser();
  const ctaEl = document.getElementById('navCta');
  const userEl = document.getElementById('navUser');
  const guestReviews = document.getElementById('navGuestReviews');
  const userRecent = document.getElementById('navUserRecent');

  if (user) {
    if (ctaEl) ctaEl.style.display = 'none';
    if (userEl) {
      userEl.style.display = 'flex';
      const n = userEl.querySelector('.nav-user-name');
      if (n) n.textContent = user.firstName || 'Account';
    }
    if (guestReviews) guestReviews.style.display = 'none';
    if (userRecent) userRecent.style.display = 'inline-block';
  } else {
    if (ctaEl) ctaEl.style.display = 'inline-block';
    if (userEl) userEl.style.display = 'none';
    if (guestReviews) guestReviews.style.display = 'inline-block';
    if (userRecent) userRecent.style.display = 'none';
  }
};

// ── UTILITIES & MODALS ────────────────────────────────────────
window.openModal=()=>document.getElementById('modal')?.classList.add('open');
window.closeModal=()=>document.getElementById('modal')?.classList.remove('open');
document.addEventListener('click',e=>{ if(e.target?.classList.contains('modal-overlay')) closeModal(); });
window.submitForm=()=>{ closeModal(); showNotif('✓ We will call you within 2 hours!'); };
window.showNotif=function(msg){ const n=document.getElementById('notif'); if(!n)return; n.textContent=msg; n.classList.add('show'); clearTimeout(n._t); n._t=setTimeout(()=>n.classList.remove('show'),3200); };
window.debounce=function(fn,delay){ let t; return function(...a){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,a),delay); }; };
window.ensureData=function(){ return true; }; 

window.showLoginPrompt=function(onDismiss){
  const ex=document.getElementById('loginPrompt');
  if(ex){ ex._onDismiss=onDismiss||null; ex.classList.add('open'); return; }
  const prompt=document.createElement('div');
  prompt.id='loginPrompt'; prompt._onDismiss=onDismiss||null;
  prompt.className='login-prompt-overlay';
  const dismiss=()=>{ prompt.classList.remove('open'); if(typeof prompt._onDismiss==='function') prompt._onDismiss(); };
  prompt.innerHTML=`<div class="login-prompt-card"><button class="login-prompt-close">✕</button><div class="login-prompt-icon">🔐</div><h2 class="login-prompt-title">Sign In</h2><p class="login-prompt-body">Please sign in to continue.</p><button class="btn-primary" style="width:100%;margin-bottom:10px" onclick="window.location='login_signup.html'">Go to Login</button></div>`;
  document.body.appendChild(prompt);
  requestAnimationFrame(()=>prompt.classList.add('open'));
  prompt.querySelector('.login-prompt-close').addEventListener('click',dismiss);
};

// ── CARD BUILDER (UPGRADED FOR MONGODB & FAKE DATA) ─────────────
// ── CARD BUILDER (UPGRADED FOR MONGODB) ─────────────
window.buildCard = function(p, featured=false) {
  const realId = p._id || p.id;
  const realTitle = p.title || 'Untitled Property';
  const realPrice = p.price ? p.price.toLocaleString('en-IN') : '0';
  
  const imgUrl = p.img || p.image || (p.images && p.images.length > 0 ? p.images[0] : 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=80');
  
  const propType = p.propertyType === 'rent' || p.intent === 'rent' ? 'For Rent' : 'For Sale';
  const badgeClass = p.propertyType === 'rent' || p.intent === 'rent' ? 'badge-rent' : 'badge-buy';
  const realLoc = p.location || (p.area ? `${p.area}, ${p.city}` : '');
  const saved = NestState.isSaved(realId);
  
  const beds = p.beds || p.bedrooms || 0;
  const baths = p.baths || p.bathrooms || 0;

  let html = `
  <div class="property-card${featured ? ' featured' : ''}" onclick="goDetail('${realId}')" data-id="${realId}">
    <div class="card-img" style="height:200px;">
      <img src="${imgUrl}" alt="${realTitle}" class="card-img-photo" loading="lazy" onload="this.classList.add('loaded')" style="width:100%;height:100%;object-fit:cover;" />
      
      <div class="card-badge ${badgeClass}">${propType}</div>
      <button class="card-save${saved ? ' saved' : ''}" onclick="toggleSave(event,this,'${realId}')" style="z-index: 10;">${saved ? '♥' : '♡'}</button>
    </div>
    <div class="card-body">
      <div class="card-price">৳ ${realPrice}</div>
      <div class="card-title">${realTitle}</div>
      <div class="card-loc">📍 ${realLoc}</div>
      <div class="card-meta">
        <div class="card-meta-item"><strong>${beds === 0 ? 'Studio' : beds}</strong> ${beds === 0 ? '' : 'Beds'}</div>
        <div class="card-meta-item"><strong>${baths}</strong> Baths</div>
      </div>
    </div>
  </div>`;
  return NestCardPlugins.apply(html, p);
};

window.toggleSave=async function(e,btn,id){
  e.stopPropagation();
  if(!NestState.isLoggedIn()){ showLoginPrompt(); return; }
  id=String(id);
  const saved=NestState.isSaved(id);
  
  if(saved){ 
    NestState.removeSaved(id); 
    btn.textContent='\u2661'; btn.classList.remove('saved'); 
    showNotif('Removed from wishlist');
    try {
      // FIX: credentials:'include' sends the httpOnly cookie
      await fetch((window.API_BASE || '/api') + '/user/saved-listings/' + id, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch(err) {}
  } else { 
    NestState.addSaved(id); 
    btn.textContent='\u2665'; btn.classList.add('saved'); 
    showNotif('Saved to wishlist \u2665'); 
    try {
      // FIX: credentials:'include' sends the httpOnly cookie
      await fetch((window.API_BASE || '/api') + '/user/saved-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ listingId: id }),
      });
    } catch(err) {}
  }
  updateNavAuth();
};

window.goDetail=function(id){ window.location=`detail.html?id=${id}`; };
window.attachCardEvents=function(){};
window.requireLogin=function(action){ if(!NestState.isLoggedIn()){showLoginPrompt();return;} if(action==='message') showNotif('✓ Message sent!'); else openModal(); };

// ── URL FILTER SYNC ───────────────────────────────────────────
window.parseUrlFilters=function(){
  const p=new URLSearchParams(location.search);
  return { type:p.get('type')||'', loc:p.get('loc')||'', budget:p.get('budget')||'', tenant:p.get('tenant')||'', gender:p.get('gender')||'', ptype:p.get('ptype')||'', beds:p.get('beds')||'', sort:p.get('sort')||'match' };
};

// ── SCROLL SPY & AUTO ACTIVE NAV ──────────────────────────────
window._setActiveNavLink=function(){
  const page=location.pathname.split('/').pop()||'index.html';
  document.querySelectorAll('.nav-links a').forEach(a=>{
    const href=a.getAttribute('href')||'';
    const aPage=href.split('?')[0].split('/').pop()||'index.html';
    a.classList.remove('active');
    if(aPage===page && !href.includes('#')) a.classList.add('active');
  });
};

window.addEventListener('DOMContentLoaded', () => {
  const navLinks = document.querySelectorAll('.nav-links a');
  const sections = document.querySelectorAll('section[id], div[id="hero"]');
  function updateActiveLink() {
    if (!document.getElementById('hero') || location.pathname.split('/').pop() !== 'index.html' && location.pathname !== '/') return;
    let currentSectionId = 'hero';
    const scrollPosition = window.scrollY + 120; 
    sections.forEach(section => { if (section.offsetTop <= scrollPosition) currentSectionId = section.getAttribute('id'); });
    navLinks.forEach(link => link.classList.remove('active'));
    let targetHref = '';
    if (['hero', 'listings'].includes(currentSectionId)) targetHref = 'listings.html'; 
    else if (currentSectionId === 'how') targetHref = '#how'; 
    else if (currentSectionId === 'features') targetHref = 'about.html'; 
    if (targetHref) {
      navLinks.forEach(link => {
        if (link.getAttribute('href') && link.getAttribute('href').endsWith(targetHref)) link.classList.add('active');
      });
    }
  }
  window.addEventListener('scroll', updateActiveLink);
  updateActiveLink();
});

// ── SCROLL REVEAL ANIMATIONS (BULLETPROOF) ──────────
window.addEventListener('DOMContentLoaded', () => {
  // Inject Compare Drawer HTML
  if(!document.getElementById('compareDrawer')){
    const drawerHtml = `
      <div id="compareDrawer">
        <div style="font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--gold);margin-right:20px;">Compare<br><span style="font-size:12px;font-family:'DM Sans',sans-serif;color:var(--text-muted);letter-spacing:0.1em;text-transform:uppercase;">Properties</span></div>
        <div class="compare-slots" id="compareSlots">
          <div class="compare-slot" data-idx="0">Add property...</div>
          <div class="compare-slot" data-idx="1">Add property...</div>
          <div class="compare-slot" data-idx="2">Add property...</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-left:auto;">
          <button class="compare-cta" onclick="openCompareModal()">Compare Now</button>
          <button class="compare-clear" onclick="clearCompare()">Clear All</button>
        </div>
      </div>
      
      <div id="compareModal">
        <div class="compare-modal-inner">
          <div class="compare-modal-header">
            <h2 class="compare-modal-title">Property Comparison</h2>
            <button class="compare-modal-close" onclick="closeCompareModal()">✕</button>
          </div>
          <div class="compare-table-wrap" style="padding:0">
            <table class="compare-table" id="compareTable">
              <!-- Rendered via JS -->
            </table>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', drawerHtml);
  }

  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting || entry.boundingClientRect.top < window.innerHeight) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '100px' });

  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

  document.querySelectorAll('a[href*="#"]').forEach(anchor => {
    anchor.addEventListener('click', () => {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    });
  });

  setTimeout(() => {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
  }, 1000);
});

// ── GLOBAL NAV AVATAR SYNC ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const user = getUser();
  if (user && user._id) { // FIX: Check _id, not token (token now in httpOnly cookie)
    const avatarEl = document.querySelector('.nav-user-avatar');
    if (avatarEl) {
      if (user.profilePicUrl) {
        avatarEl.innerHTML = `<img src="${user.profilePicUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        avatarEl.style.background = 'transparent';
      } else {
        avatarEl.innerHTML = user.firstName ? user.firstName.charAt(0).toUpperCase() : 'U';
      }
    }
  }
});

window.API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? 'http://localhost:5000/api' 
  : '/api';

// ── CENTRALIZED API FETCH HELPER ──────────────────────────────
// Always includes credentials (sends httpOnly cookie) so no page needs
// to manually manage tokens. Replaces all `Authorization: Bearer` patterns.
window.apiFetch = async function(url, options = {}) {
  const defaultOptions = {
    credentials: 'include',   // Sends the httpOnly nestiq_token cookie automatically
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  };
  // Remove Content-Type for FormData (let browser set multipart boundary)
  if (options.body instanceof FormData) {
    delete defaultOptions.headers['Content-Type'];
  }
  const fullUrl = url.startsWith('http') ? url : (window.API_BASE + url);
  return fetch(fullUrl, { ...defaultOptions, ...options, headers: { ...defaultOptions.headers, ...(options.headers || {}) } });
};

// ── COMPARE LOGIC ─────────────────────────────────────────────
window.compareList = [];

window.toggleCompare = function(cb, id, title, img, price, area, beds, baths, intent) {
  if (cb.checked) {
    if (window.compareList.length >= 3) {
      showNotif('You can compare up to 3 properties');
      cb.checked = false;
      return;
    }
    window.compareList.push({ id, title, img, price, area, beds, baths, intent });
  } else {
    window.compareList = window.compareList.filter(p => String(p.id) !== String(id));
  }
  updateCompareDrawer();
};

window.updateCompareDrawer = function() {
  const drawer = document.getElementById('compareDrawer');
  if (!drawer) return;
  if (window.compareList.length > 0) {
    drawer.classList.add('open');
  } else {
    drawer.classList.remove('open');
  }
  
  const slots = document.getElementById('compareSlots');
  if (!slots) return;
  
  let html = '';
  for(let i=0; i<3; i++) {
    const p = window.compareList[i];
    if (p) {
      html += `<div class="compare-slot filled">
                 <img src="${p.img}" style="width:40px;height:40px;object-fit:cover;border-radius:2px;">
                 <div style="flex:1;overflow:hidden;">
                   <div style="font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.title}</div>
                   <div style="font-size:11px;">৳ ${Number(p.price).toLocaleString('en-IN')}</div>
                 </div>
                 <button class="compare-slot-remove" onclick="removeCompare('${p.id}')">✕</button>
               </div>`;
    } else {
      html += `<div class="compare-slot">Add property...</div>`;
    }
  }
  slots.innerHTML = html;
};

window.removeCompare = function(id) {
  window.compareList = window.compareList.filter(p => String(p.id) !== String(id));
  const cb = document.getElementById('comp_' + id);
  if (cb) cb.checked = false;
  updateCompareDrawer();
};

window.clearCompare = function() {
  window.compareList.forEach(p => {
    const cb = document.getElementById('comp_' + p.id);
    if (cb) cb.checked = false;
  });
  window.compareList = [];
  updateCompareDrawer();
};

window.openCompareModal = function() {
  if (window.compareList.length < 2) {
    showNotif('Add at least 2 properties to compare');
    return;
  }
  
  let html = `
    <tr>
      <th style="width:160px;background:var(--surface);"></th>
      ${window.compareList.map(p => `
        <th class="prop-col">
          <img src="${p.img}" style="width:100%;height:140px;object-fit:cover;border-radius:4px;margin-bottom:12px;">
          <div class="compare-prop-price">৳ ${Number(p.price).toLocaleString('en-IN')}</div>
          <div class="compare-prop-title">${p.title}</div>
          <div class="compare-prop-loc">${p.area}</div>
        </th>
      `).join('')}
    </tr>
    <tr>
      <td class="row-label">Intent</td>
      ${window.compareList.map(p => `<td class="prop-col" style="text-transform:capitalize">${p.intent}</td>`).join('')}
    </tr>
    <tr>
      <td class="row-label">Price</td>
      ${window.compareList.map(p => `<td class="prop-col compare-highlight">৳ ${Number(p.price).toLocaleString('en-IN')}</td>`).join('')}
    </tr>
    <tr>
      <td class="row-label">Bedrooms</td>
      ${window.compareList.map(p => `<td class="prop-col">${p.beds || 0}</td>`).join('')}
    </tr>
    <tr>
      <td class="row-label">Bathrooms</td>
      ${window.compareList.map(p => `<td class="prop-col">${p.baths || 0}</td>`).join('')}
    </tr>
    <tr>
      <td class="row-label">Area</td>
      ${window.compareList.map(p => `<td class="prop-col">${p.area}</td>`).join('')}
    </tr>
    <tr>
      <td></td>
      ${window.compareList.map(p => `<td class="prop-col"><button class="btn-outline" style="width:100%;font-size:11px;padding:8px" onclick="goDetail('${p.id}')">View Details</button></td>`).join('')}
    </tr>
  `;
  document.getElementById('compareTable').innerHTML = html;
  document.getElementById('compareModal').classList.add('open');
};

window.closeCompareModal = function() {
  document.getElementById('compareModal').classList.remove('open');
};

NestCardPlugins.register(function(html, p) {
  const safeTitle = (p.title || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const safeArea = (p.area || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const safeIntent = (p.intent || '').replace(/'/g, "\\'");
  const safePrice = (p.priceRaw || p.price || 0).toString().replace(/'/g, "\\'");
  const cbHtml = `<div class="card-compare-wrap" onclick="event.stopPropagation()"><input type="checkbox" id="comp_${p.id || p._id}" onchange="toggleCompare(this, '${p.id || p._id}', '${safeTitle}', '${p.img || ''}', '${safePrice}', '${safeArea}', ${p.beds || 0}, ${p.baths || 0}, '${safeIntent}')"><label for="comp_${p.id || p._id}">Compare</label></div>`;
  return html.replace('<div class="card-meta">', cbHtml + '<div class="card-meta">');
});