// Leila Portal — Supabase 기기간 동기화 (선택적).
// 설정이 없거나 오프라인이면 조용히 '이 기기에만 저장' 모드로 폴백합니다.
(async () => {
  const cfg = window.LEILA_SUPABASE || {};
  const el = id => document.getElementById(id);
  const els = {
    form: el('sync-auth-form'),
    email: el('sync-email'),
    password: el('sync-password'),
    signin: el('sync-signin'),
    signup: el('sync-signup'),
    signout: el('sync-signout'),
    state: el('sync-account-state'),
    badge: el('sync-status')
  };
  const setState = msg => { if (els.state) els.state.textContent = msg; };
  const setBadge = msg => { if (els.badge) els.badge.textContent = msg; };

  const configured = cfg.url && cfg.anonKey && !/^YOUR_/.test(cfg.url) && !/^YOUR_/.test(cfg.anonKey);
  if (!configured) {
    setState('클라우드 동기화가 아직 설정되지 않았어요. 이 기기에만 저장됩니다.');
    if (els.form) els.form.classList.add('hidden');
    return;
  }

  let createClient;
  try {
    ({ createClient } = await import('https://esm.sh/@supabase/supabase-js@2'));
  } catch (error) {
    console.warn('[LeilaSync] 라이브러리 로드 실패 — 로컬 전용', error);
    setState('네트워크 문제로 동기화 라이브러리를 불러오지 못했어요. 이 기기에만 저장됩니다.');
    return;
  }

  const supabase = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const app = (window.__leilaApp = window.__leilaApp || {});
  const LOCAL_UPDATED_KEY = 'leila-sync-updated-at';
  const nowIso = () => new Date().toISOString();
  const localUpdated = () => localStorage.getItem(LOCAL_UPDATED_KEY) || '';
  const markUpdated = ts => { try { localStorage.setItem(LOCAL_UPDATED_KEY, ts); } catch {} };

  let currentUser = null;
  let channel = null;
  let pushTimer = null;
  let lastPushedAt = null;
  let applyingRemote = false;

  async function push(immediate = false) {
    if (!currentUser || !app.getState) return;
    const doPush = async () => {
      const ts = nowIso();
      const { error } = await supabase.from('snapshots').upsert({ user_id: currentUser.id, data: app.getState(), updated_at: ts });
      if (error) { console.warn('[LeilaSync] push 오류', error); setBadge('동기화 대기 중…'); return; }
      lastPushedAt = ts;
      markUpdated(ts);
      setBadge('동기화됨 · ' + (currentUser.email || ''));
    };
    clearTimeout(pushTimer);
    if (immediate) return doPush();
    pushTimer = setTimeout(doPush, 900);
  }

  async function pullAndReconcile() {
    const { data, error } = await supabase.from('snapshots').select('data, updated_at').eq('user_id', currentUser.id).maybeSingle();
    if (error) { console.warn('[LeilaSync] pull 오류', error); return; }
    if (data && (!localUpdated() || data.updated_at >= localUpdated())) {
      applyingRemote = true;
      app.applyRemoteState?.(data.data);
      markUpdated(data.updated_at);
      applyingRemote = false;
    } else {
      await push(true); // 원격이 없거나 로컬이 더 최신 → 로컬을 올림
    }
  }

  function subscribeRealtime() {
    if (channel) supabase.removeChannel(channel);
    channel = supabase.channel('snap-' + currentUser.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'snapshots', filter: 'user_id=eq.' + currentUser.id }, payload => {
        const row = payload.new;
        if (!row || !row.data || row.updated_at === lastPushedAt) return; // 내가 방금 올린 건 무시
        applyingRemote = true;
        app.applyRemoteState?.(row.data);
        markUpdated(row.updated_at);
        applyingRemote = false;
      })
      .subscribe();
  }

  async function onLogin(user) {
    if (currentUser && currentUser.id === user.id) return;
    currentUser = user;
    els.form?.classList.add('hidden');
    els.signout?.classList.remove('hidden');
    window.__leilaSyncActive = true;
    setState(user.email + ' 으로 로그인됨 — 기기간 동기화가 켜졌어요.');
    setBadge('동기화됨 · ' + user.email);
    await pullAndReconcile();
    subscribeRealtime();
  }

  function onLogout() {
    currentUser = null;
    window.__leilaSyncActive = false;
    if (channel) { supabase.removeChannel(channel); channel = null; }
    els.form?.classList.remove('hidden');
    els.signout?.classList.add('hidden');
    setState('로그아웃 상태 — 로그인하면 여러 기기에서 같은 데이터를 쓸 수 있어요.');
    setBadge('이 기기에 저장 중');
  }

  // 로컬 변경 → 원격 push (app.js의 saveState가 호출)
  app.onLocalChange = () => { if (currentUser && !applyingRemote) push(false); };

  async function handleAuth(mode) {
    const email = (els.email?.value || '').trim();
    const password = els.password?.value || '';
    if (!email || !password) return setState('이메일과 비밀번호를 입력해 주세요.');
    if (mode === 'signup' && password.length < 6) return setState('비밀번호는 6자 이상이어야 해요.');
    setState(mode === 'signup' ? '가입 중…' : '로그인 중…');
    const { data, error } = mode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) return setState('오류: ' + error.message);
    if (mode === 'signup' && !data.session) setState('가입 완료! 이메일 인증이 필요하면 메일함을 확인한 뒤 로그인하세요.');
    // 세션이 생기면 onAuthStateChange가 onLogin 처리
  }

  els.signin?.addEventListener('click', () => handleAuth('signin'));
  els.signup?.addEventListener('click', () => handleAuth('signup'));
  els.signout?.addEventListener('click', () => supabase.auth.signOut());
  els.form?.addEventListener('submit', event => { event.preventDefault(); handleAuth('signin'); });

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) onLogin(session.user);
    else onLogout();
  });
})();
