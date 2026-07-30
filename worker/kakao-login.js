/**
 * 카카오 로그인 → Firebase 전용 토큰 발급 (Cloudflare Worker)
 *
 * Firebase 로그인에는 카카오 제공업체가 없다. 그래서 이 다리가 필요하다.
 * 카카오가 확인해 준 사람을 Firebase 가 인정하는 토큰으로 바꿔주는 일만 한다.
 *
 * 이 일을 브라우저에서 하면 안 되는 이유:
 *   · 카카오 Client Secret 이 노출된다
 *   · Firebase 서비스 계정 키가 노출된다 → 아무 계정으로나 로그인할 수 있게 된다
 *
 * 로그인할 때 한 번만 호출된다. 그 뒤 기록을 읽고 쓰는 것은 앱이 Firestore 와
 * 직접 하므로, 이 Worker 가 멈춰도 이미 로그인한 사람은 계속 쓸 수 있다.
 *
 * ── Cloudflare 에 넣어야 하는 값 (Settings → Variables → Secret) ──
 *   KAKAO_REST_KEY       카카오 개발자 > 플랫폼 키 > REST API 키
 *   KAKAO_CLIENT_SECRET  (선택) 카카오 로그인 > 보안 > Client Secret. 안 켰으면 넣지 않는다
 *   FB_CLIENT_EMAIL      Firebase 서비스 계정 JSON 의 client_email
 *   FB_PRIVATE_KEY       Firebase 서비스 계정 JSON 의 private_key (----BEGIN 부터 전부)
 *   ALLOW_ORIGIN         https://jewa-bro.github.io
 */

const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const KAKAO_ME_URL    = 'https://kapi.kakao.com/v2/user/me';
const FB_AUDIENCE     = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
// 앱 코드에 이미 공개되어 있는 웹 API 키. 진단(/debug)에서만 쓴다
const FB_WEB_KEY      = 'AIzaSyBg5ccH49HpSaKewLF_376ysjnFDR2Jfks';

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
      });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    /* 진단용. auth/invalid-custom-token 이 났을 때 원인을 찾기 위한 것.
       카카오를 거치지 않고 토큰만 만들어 Firebase 에 직접 넣어보고 그 응답을 돌려준다.
       비공개 키는 절대 내보내지 않는다. 서비스 계정 이메일은 비밀이 아니다. */
    if (request.method === 'GET' && new URL(request.url).pathname === '/debug') {
      const out = {};
      try {
        const token = await makeFirebaseToken('debug:selftest', { provider: 'debug' }, env);
        const parts = token.split('.');
        out.토큰조각수 = parts.length;
        out.payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        out.설정 = {
          FB_CLIENT_EMAIL_있음: !!env.FB_CLIENT_EMAIL,
          FB_CLIENT_EMAIL_앞뒤공백: env.FB_CLIENT_EMAIL !== String(env.FB_CLIENT_EMAIL || '').trim(),
          FB_PRIVATE_KEY_길이: String(env.FB_PRIVATE_KEY || '').length,
          FB_PRIVATE_KEY_시작: String(env.FB_PRIVATE_KEY || '').slice(0, 27),
          FB_PRIVATE_KEY_끝: String(env.FB_PRIVATE_KEY || '').trim().slice(-25),
        };
        // Firebase 에 실제로 넣어본다. 여기서 나오는 message 가 진짜 원인이다
        const r = await fetch(
          'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + FB_WEB_KEY,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, returnSecureToken: true }) }
        );
        const fb = await r.json();
        out.firebase상태 = r.status;
        out.firebase응답 = r.ok ? { 성공: true, localId: fb.localId } : fb.error;
      } catch (err) {
        out.예외 = String(err);
      }
      return json(out);
    }

    if (request.method !== 'POST')    return json({ error: 'POST 만 받습니다' }, 405);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: '잘못된 요청' }, 400); }

    const { code, redirectUri } = body || {};
    if (!code || !redirectUri) return json({ error: 'code 와 redirectUri 가 필요합니다' }, 400);

    try {
      // ① 카카오: 인증 코드 → 액세스 토큰
      // Client Secret 은 카카오에서 선택 기능이다. 켜지 않았다면 아예 보내지 않는다
      // (빈 값을 보내면 오히려 거절당한다)
      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.KAKAO_REST_KEY,
        redirect_uri: redirectUri,
        code,
      });
      if (env.KAKAO_CLIENT_SECRET) form.set('client_secret', env.KAKAO_CLIENT_SECRET);

      const tokenRes = await fetch(KAKAO_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form,
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        return json({ error: '카카오 토큰 발급 실패', detail: tokenData }, 401);
      }

      // ② 카카오: 액세스 토큰 → 사용자 번호
      const meRes = await fetch(KAKAO_ME_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const me = await meRes.json();
      if (!meRes.ok || !me.id) {
        return json({ error: '카카오 사용자 확인 실패', detail: me }, 401);
      }

      // ③ Firebase 전용 토큰 서명. uid 는 카카오 사용자 번호로 고정해
      //    같은 사람이 항상 같은 기록에 들어가게 한다
      const uid = `kakao:${me.id}`;
      const nick = me.kakao_account?.profile?.nickname || me.properties?.nickname || '';
      const token = await makeFirebaseToken(uid, { provider: 'kakao', nickname: nick }, env);

      return json({ token, uid });
    } catch (err) {
      return json({ error: '서버 오류', detail: String(err) }, 500);
    }
  },
};

/* ── Firebase 커스텀 토큰(JWT) 만들기 ── */
async function makeFirebaseToken(uid, claims, env) {
  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.FB_CLIENT_EMAIL,
    sub: env.FB_CLIENT_EMAIL,
    aud: FB_AUDIENCE,
    iat: now,
    exp: now + 3600,
    uid,
    claims,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = await importPrivateKey(env.FB_PRIVATE_KEY);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${b64urlBytes(new Uint8Array(sig))}`;
}

async function importPrivateKey(pem) {
  // 환경변수에 넣을 때 줄바꿈이 \n 문자열로 들어오는 경우가 많다
  const clean = String(pem).replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

const b64url = str => b64urlBytes(new TextEncoder().encode(str));
const b64urlBytes = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
