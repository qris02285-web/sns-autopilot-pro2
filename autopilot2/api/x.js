import crypto from 'crypto';

function pct(s) {
  return encodeURIComponent(String(s))
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildOAuth(method, url, params) {
  const k = {
    key:     process.env.X_API_KEY,
    secret:  process.env.X_API_SECRET,
    token:   process.env.X_ACCESS_TOKEN,
    tsecret: process.env.X_ACCESS_TOKEN_SECRET,
  };
  if (!k.key) throw new Error('X_API_KEY が Vercel 環境変数に設定されていません');
  const op = {
    oauth_consumer_key:     k.key,
    oauth_nonce:            crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
    oauth_token:            k.token,
    oauth_version:          '1.0',
  };
  const all  = { ...params, ...op };
  const pstr = Object.keys(all).sort().map(k => `${pct(k)}=${pct(all[k])}`).join('&');
  const base = `${method}&${pct(url)}&${pct(pstr)}`;
  const sigKey = `${pct(k.secret)}&${pct(k.tsecret)}`;
  op.oauth_signature = crypto.createHmac('sha1', sigKey).update(base).digest('base64');
  return 'OAuth ' + Object.entries(op).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
}

async function xGet(url, params = {}) {
  const auth = buildOAuth('GET', url, params);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(qs ? `${url}?${qs}` : url, { headers: { Authorization: auth } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.title || (data.errors?.[0]?.message) || `HTTP ${res.status}`);
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type = 'search', q = '副業', max = '10' } = req.query;
  const n = Math.min(Math.max(parseInt(max) || 10, 1), 10);

  try {
    if (type === 'ping') {
      const d = await xGet('https://api.twitter.com/2/users/me', { 'user.fields': 'name,username,public_metrics' });
      return res.json({ ok: true, user: d.data });
    }
    if (type === 'search') {
      const params = {
        query: `${q} -is:retweet lang:ja`,
        max_results: n.toString(),
        'tweet.fields': 'public_metrics,created_at,author_id',
        expansions: 'author_id',
        'user.fields': 'name,username,public_metrics,description',
      };
      const d = await xGet('https://api.twitter.com/2/tweets/search/recent', params);
      const users = {};
      (d.includes?.users || []).forEach(u => { users[u.id] = u; });
      const tweets = (d.data || []).map(t => ({
        id: t.id, text: t.text, created_at: t.created_at,
        likes: t.public_metrics?.like_count || 0,
        retweets: t.public_metrics?.retweet_count || 0,
        replies: t.public_metrics?.reply_count || 0,
        engagement: (t.public_metrics?.like_count || 0) + (t.public_metrics?.retweet_count || 0),
        author: users[t.author_id] ? {
          name: users[t.author_id].name,
          username: users[t.author_id].username,
          followers: users[t.author_id].public_metrics?.followers_count || 0,
          description: users[t.author_id].description || '',
        } : null,
      })).sort((a, b) => b.engagement - a.engagement);
      return res.json({ tweets, total: tweets.length });
    }
    if (type === 'my_stats') {
      const me = await xGet('https://api.twitter.com/2/users/me', { 'user.fields': 'name,username,public_metrics' });
      const uid = me.data?.id;
      if (!uid) throw new Error('ユーザーIDを取得できませんでした');
      const tw = await xGet(`https://api.twitter.com/2/users/${uid}/tweets`, {
        max_results: n.toString(),
        'tweet.fields': 'public_metrics,created_at,non_public_metrics',
      });
      const posts = (tw.data || []).map(t => {
        const imp = t.non_public_metrics?.impression_count || 0;
        const eng = (t.public_metrics?.like_count || 0) + (t.public_metrics?.retweet_count || 0) + (t.public_metrics?.reply_count || 0);
        return {
          id: t.id, text: t.text.substring(0, 120) + (t.text.length > 120 ? '…' : ''),
          created_at: t.created_at,
          impressions: imp, likes: t.public_metrics?.like_count || 0,
          retweets: t.public_metrics?.retweet_count || 0, replies: t.public_metrics?.reply_count || 0,
          er: imp > 0 ? ((eng / imp) * 100).toFixed(2) : '0',
        };
      });
      return res.json({ user: me.data, posts });
    }
    return res.status(400).json({ error: `不明な type: ${type}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
