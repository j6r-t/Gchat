// public/app.js
// Chat UI with streaming, Markdown, code highlight, persona switcher,
// typing animations, edit-only-last-user, and a sidebar of saved chats.
// Works without DOMContentLoaded if this script is placed at the end of <body>.

/* ---------------- Boot guard ---------------- */
function requireEl(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

try {
  /* ---------------- Grab elements ---------------- */
  const chatEl     = requireEl('chat');
  const form       = requireEl('composer');
  const input      = requireEl('input');
  const sendBtn    = requireEl('send');

  // optional controls
  const modelSel   = document.getElementById('model');
  const thinkingEl = document.getElementById('thinking');
  const clearBtn   = document.getElementById('clear');
  const personaSel = document.getElementById('persona');

  // sidebar (optional)
  const threadsEl  = document.getElementById('threads');
  const newChatBtn = document.getElementById('newChat');

  console.log('[Chat] wired ✓', { hasModel: !!modelSel, hasPersona: !!personaSel });

  /* ---------------- State ---------------- */
  let chatHistory = [];   // [{role:'user'|'assistant', content:string}]
  let messageEls  = [];   // mirrors chatHistory: {wrap,row,avatar,bubble}
  let isStreaming = false;

  /* ---------------- Storage: threads (localStorage) ---------------- */
  function loadThreads(){ try { return JSON.parse(localStorage.getItem('threads') || '{}'); } catch { return {}; } }
  function saveThreads(obj){ localStorage.setItem('threads', JSON.stringify(obj)); }
  function titleFrom(history){ const u = history.find(m=>m.role==='user'); return u ? (u.content||'New chat').slice(0,40) : 'New chat'; }

  let THREADS = loadThreads();
  let currentThreadId = null; 
  bootstrapThreads();              // decide which thread to open

  function bootstrapThreads() {
    const stored = localStorage.getItem('currentThreadId');
    if (stored && THREADS[stored]) {
      setCurrentThread(stored);    // sets currentThreadId internally
    } else {
      createThread();              // createThread() will call setCurrentThread()
    }
  }
  function createThread(){
    const id = 't_' + Date.now().toString(36);
    THREADS[id] = { id, title:'New chat', history:[], updatedAt:Date.now() };
    saveThreads(THREADS);
    setCurrentThread(id);
    return id;
  }

  function setCurrentThread(id){
    currentThreadId = id;
    localStorage.setItem('currentThreadId', id);
    chatHistory = (THREADS[id]?.history || []).map(m => ({...m}));
    renderChatFromHistory();
    renderSidebar();
  }

  function saveCurrentThread(){
    if (!THREADS[currentThreadId]) THREADS[currentThreadId] = { id: currentThreadId };
    THREADS[currentThreadId].history = chatHistory.map(m => ({...m}));
    THREADS[currentThreadId].title   = titleFrom(chatHistory);
    THREADS[currentThreadId].updatedAt = Date.now();
    saveThreads(THREADS);
    renderSidebar();
  }

  function renderSidebar(){
    if (!threadsEl) return;
    threadsEl.innerHTML = '';
    const entries = Object.values(THREADS).sort((a,b)=>b.updatedAt-a.updatedAt);
    for (const t of entries) {
      const li = document.createElement('li');
      if (t.id === currentThreadId) li.classList.add('active');
  
      const title = document.createElement('div');
      title.className = 't-title';
      title.textContent = t.title || 'New chat';
  
      const sub = document.createElement('div');
      sub.className = 't-sub';
      sub.textContent = new Date(t.updatedAt).toLocaleString();
  
      // delete button
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 't-del';
      del.setAttribute('aria-label', 'Delete chat');
      del.textContent = 'Delete';
  
      del.addEventListener('click', (e) => {
        e.stopPropagation();          // don’t open the chat when clicking delete
        deleteThread(t.id);
      });
  
      li.append(title, sub, del);
      li.addEventListener('click', ()=> setCurrentThread(t.id));
      threadsEl.append(li);
    }
  }
  function deleteThread(id){
    if (!THREADS[id]) return;
    const name = THREADS[id].title || 'New chat';
    if (!confirm(`Delete chat "${name}"? This cannot be undone.`)) return;
  
    delete THREADS[id];
    saveThreads(THREADS);
  
    // If we deleted the open chat, switch to the most recent remaining chat
    if (id === currentThreadId) {
      const remaining = Object.values(THREADS).sort((a,b)=>b.updatedAt - a.updatedAt);
      if (remaining.length) {
        setCurrentThread(remaining[0].id);
      } else {
        // No chats left → create a fresh one
        const newId = createThread();
        setCurrentThread(newId);
        chatHistory = [];
        renderChatFromHistory();
      }
    } else {
      renderSidebar();
    }
  }
  

  /* ---------------- DOM helpers ---------------- */
  function el(tag, cls, text=''){ const x=document.createElement(tag); if(cls) x.className=cls; if(text) x.textContent=text; return x; }

  function addMessage(role, content=''){
    const wrap   = el('div', `message ${role}`);
    const row    = el('div', 'row');
    const avatar = el('div', 'avatar', role === 'user' ? 'U' : 'G');
    const bubble = el('div', 'bubble');
    bubble.innerHTML = renderMD(content);
    row.append(avatar, bubble);
    wrap.append(row);
    chatEl.append(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
    messageEls.push({ wrap, row, avatar, bubble });
    return bubble;
  }

  function resetChatDOM(){ chatEl.innerHTML=''; messageEls = []; }

  function renderChatFromHistory(){
    resetChatDOM();
    for (const m of chatHistory) {
      const bubble = addMessage(m.role, m.content);
      if (m.role === 'assistant') highlightWithin(bubble);
    }
    attachEditForLastUser();
  }

  function setLoading(b, v){ b?.classList.toggle('loading', !!v); }

  /* ---------------- Markdown & highlight ---------------- */
  function escapeHTML(txt){ return txt.replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function renderMD(md){
    if (window.marked && window.DOMPurify) {
      const html = marked.parse(md, { gfm:true, breaks:true, headerIds:false, mangle:false });
      return DOMPurify.sanitize(html);
    }
    return escapeHTML(md).replace(/\n/g,'<br/>');
  }
  function highlightWithin(el){ if (window.Prism) Prism.highlightAllUnder(el); }

  /* ---------------- Edit only the last user message ---------------- */
  function attachEditForLastUser(){
    document.querySelectorAll('.edit-btn').forEach(b=>b.remove());
    if (chatHistory.length < 2) return;

    const lastIdx = chatHistory.length - 1;
    if (chatHistory[lastIdx].role !== 'assistant') return;

    const userIdx = lastIdx - 1;
    if (!chatHistory[userIdx] || chatHistory[userIdx].role !== 'user') return;

    const bubble = messageEls[userIdx]?.bubble;
    if (!bubble) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'edit-btn';
    btn.textContent = 'Edit';
    bubble.appendChild(btn);
    btn.addEventListener('click', ()=> startEditLastUser(userIdx, bubble));
  }

  async function startEditLastUser(userIdx, bubble){
    if (isStreaming) return;
    const original = chatHistory[userIdx].content;

    // build inline editor
    bubble.innerHTML = '';
    const ta = document.createElement('textarea'); ta.className='edit-area'; ta.value=original;
    const controls = document.createElement('div'); controls.className='edit-controls';
    const save = document.createElement('button'); save.type='button'; save.className='save'; save.textContent='Save';
    const cancel = document.createElement('button'); cancel.type='button'; cancel.className='cancel'; cancel.textContent='Cancel';
    controls.append(save, cancel); bubble.append(ta, controls); ta.focus();

    cancel.onclick = () => { bubble.innerHTML = renderMD(original); attachEditForLastUser(); };

    save.onclick = async () => {
      const updated = ta.value.trim(); if (!updated) return;
      // update user turn
      chatHistory[userIdx].content = updated;
      bubble.innerHTML = renderMD(updated);

      // remove following assistant answer
      const assistIdx = userIdx + 1;
      if (chatHistory[assistIdx]?.role === 'assistant') {
        chatHistory.splice(assistIdx, 1);
        const nodes = chatEl.querySelectorAll('.message');
        nodes[assistIdx]?.remove();
        messageEls.splice(assistIdx, 1);
      }

      // re-generate using earlier history + edited user text
      const prior = chatHistory.slice(0, userIdx);
      await streamAssistant(updated, prior);
      attachEditForLastUser();
      saveCurrentThread();
    };
  }

  /* ---------------- Streaming ---------------- */
  async function streamAssistant(message, historyForReq){
    const bubble = addMessage('assistant', '');
    const row = bubble.parentElement;
    const avatar = row.querySelector('.avatar');

    setLoading(bubble, true);
    isStreaming = true;

    // thinking indicator + dots
    avatar?.classList.add('thinking');
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    bubble.append(indicator);

    const model          = modelSel?.value || 'gemini-2.5-flash';
    const thinkingBudget = Number(thinkingEl?.value) || 0;
    const persona        = personaSel?.value || 'general';
    bubble.dataset.persona = persona;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: historyForReq, model, thinkingBudget, persona })
      });

      if (!res.ok || !res.body) {
        setLoading(bubble, false);
        indicator.remove();
        avatar?.classList.remove('thinking','typing');
        bubble.textContent = `Error: ${res.status} — check server logs.`;
        isStreaming = false;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let started = false;
      let caret = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        assistantText += chunk;

        if (!started) {
          started = true;
          indicator.remove();
          avatar?.classList.remove('thinking');
          avatar?.classList.add('typing');
          caret = document.createElement('span'); caret.className = 'caret';
        }

        bubble.innerHTML = renderMD(assistantText);
        if (caret) bubble.append(caret);
        chatEl.scrollTop = chatEl.scrollHeight;
      }

      setLoading(bubble, false);
      avatar?.classList.remove('typing');
      if (caret) caret.remove();
      bubble.innerHTML = renderMD(assistantText);
      highlightWithin(bubble);

      chatHistory.push({ role: 'assistant', content: assistantText });
    } catch (err) {
      setLoading(bubble, false);
      indicator.remove();
      avatar?.classList.remove('thinking','typing');
      bubble.textContent = 'Network error — check server console.';
      console.error(err);
    } finally {
      isStreaming = false;
    }
  }

  /* ---------------- Send flow ---------------- */
  async function send(message){
    if (isStreaming) return;
    addMessage('user', message);
    chatHistory.push({ role: 'user', content: message });

    // stream answer using history BEFORE the latest user message
    const prior = chatHistory.slice(0, chatHistory.length - 1);
    await streamAssistant(message, prior);

    attachEditForLastUser();
    saveCurrentThread();
  }

  /* ---------------- Events ---------------- */
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(200, input.scrollHeight) + 'px';
  });

  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = ''; input.style.height = 'auto';
    send(text);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = ''; input.style.height = 'auto';
    send(text);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  });

  clearBtn?.addEventListener('click', () => {
    chatHistory = [];
    renderChatFromHistory();
    input.focus();
    saveCurrentThread();
  });

  // remember persona
  if (personaSel) {
    const savedPersona = localStorage.getItem('persona');
    if (savedPersona) personaSel.value = savedPersona;
    personaSel.addEventListener('change', () => localStorage.setItem('persona', personaSel.value));
  }

  // sidebar new chat
  newChatBtn?.addEventListener('click', () => {
    createThread();
    chatHistory = [];
    renderChatFromHistory();
    const greet = addMessage('assistant', 'Hello! Ask me anything.');
    highlightWithin(greet);
  });

  // boot UI
  renderSidebar();
  if (chatHistory.length === 0) {
    const greet = addMessage('assistant', 'Hello! Ask me anything.');
    highlightWithin(greet);
  }
} catch (e) {
  console.error('[Chat] boot failed:', e);
  const msg = document.createElement('div');
  msg.style.cssText = 'position:fixed;inset:10px;z-index:9999;background:#1a1f27;color:#fff;border:1px solid #333;border-radius:10px;padding:12px;font:14px system-ui';
  msg.innerHTML = `<b>Init error:</b> ${e.message}`;
  document.body.append(msg);
}

/* ---------------- Helpers (global) ---------------- */
function escapeHTML(txt){ return txt.replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function renderMD(md){
  if (window.marked && window.DOMPurify) {
    const html = marked.parse(md, { gfm:true, breaks:true, headerIds:false, mangle:false });
    return DOMPurify.sanitize(html);
  }
  return escapeHTML(md).replace(/\n/g,'<br/>');
}
function highlightWithin(el){ if (window.Prism) Prism.highlightAllUnder(el); }
