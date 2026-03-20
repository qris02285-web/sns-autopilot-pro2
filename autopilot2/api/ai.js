export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { type, tweets, draft, genre, tone, offer, flw } = req.body || {};

  try {
    let prompt = '';

    // ── トレンド分析 + バズパターン抽出 ──
    if (type === 'analyze_trends') {
      const sample = (tweets || []).slice(0, 8).map((t, i) =>
        `[${i+1}] いいね:${t.likes} RT:${t.retweets}\n${t.text.substring(0, 150)}`
      ).join('\n\n');

      prompt = `あなたはSNSマーケティングの専門家です。
以下は${genre || '副業・ビジネス'}ジャンルのXでバズった投稿サンプルです。

${sample}

以下の形式でJSONのみ返してください（他のテキスト不要）：
{
  "trends": ["トレンドキーワード1", "トレンドキーワード2", "トレンドキーワード3", "トレンドキーワード4", "トレンドキーワード5"],
  "patterns": [
    {"name": "パターン名", "desc": "特徴の説明（30字以内）", "example": "冒頭フック例文"},
    {"name": "パターン名", "desc": "特徴の説明（30字以内）", "example": "冒頭フック例文"},
    {"name": "パターン名", "desc": "特徴の説明（30字以内）", "example": "冒頭フック例文"}
  ],
  "insight": "このジャンルで今バズる投稿の共通点（100字以内）"
}`;
    }

    // ── 投稿文をバズり仕様に最適化 ──
    else if (type === 'optimize_post') {
      const trendInfo = (tweets || []).slice(0, 5).map(t => t.text.substring(0, 100)).join('\n');
      prompt = `あなたはXの副業・ビジネス系インフルエンサーのゴーストライターです。

【現在のフォロワー数】${flw || 0}人
【発信トーン】${tone || '正直・等身大'}
【DMオファー】${offer || ''}
【参考バズ投稿（トレンド）】
${trendInfo}

【修正前の投稿文】
${draft}

上記の投稿文を、バズ投稿のパターンを参考にしながら以下の条件でXの投稿文に最適化してください：
- 280文字以内
- 冒頭2行で強いフックを作る
- 現在のトレンドキーワードを自然に盛り込む
- DM誘導CTAを末尾に自然に入れる（フォロワー数${flw || 0}人に合った強度で）
- #副業 #ビジネス のハッシュタグを付ける

最適化した投稿文のみ返してください（説明不要）。`;
    }

    // ── トレンドキーワードで投稿文を新規生成 ──
    else if (type === 'generate_trend_post') {
      const keyword = tweets || '副業';
      prompt = `あなたはXの副業・ビジネス系インフルエンサーです。

【テーマ】${keyword}
【フォロワー数】${flw || 0}人
【トーン】${tone || '正直・等身大'}
【DMオファー】${offer || '限定情報'}

今日のトレンドを活かした副業・ビジネス系のXの投稿文を1つ作ってください。
条件：
- 280文字以内
- 冒頭でトレンドに乗ったフック
- 体験談や具体的な数字を入れる
- 末尾にDM誘導CTA（フォロワー数に応じた強度）
- #副業 #ビジネス

投稿文のみ返してください。`;
    }

    else {
      return res.status(400).json({ error: `不明な type: ${type}` });
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiData.error?.message || `Anthropic API error: ${aiRes.status}`);

    const text = aiData.content?.[0]?.text || '';

    if (type === 'analyze_trends') {
      const clean = text.replace(/```json|```/g, '').trim();
      try {
        return res.json(JSON.parse(clean));
      } catch {
        return res.json({ trends: [], patterns: [], insight: text.substring(0, 100) });
      }
    }
    return res.json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
