import { type NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { apiKey, emails } = await request.json();
    
    if (!apiKey || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({ error: 'Missing API key or emails.' }, { status: 400 });
    }

    if (emails.length > 50) {
      return NextResponse.json({ error: 'Too many emails in batch (max 50).' }, { status: 400 });
    }

    const prompt = `You are an email classification assistant. Classify the following emails into one of these exact categories: 'newsletter', 'transaction', 'social', 'personal'.
- 'newsletter': Promotional emails, circulars, advertisements, newsletters, updates.
- 'transaction': Receipts, invoices, order confirmations, bill reminders, shipping updates, one-time passwords (OTP), account creation confirmation, password reset links.
- 'social': Notifications from social networks like LinkedIn, Facebook, Twitter/X, Instagram, GitHub updates, comments, followers.
- 'personal': Direct human-to-human emails, personalized messages, and conversations that do not fit the other categories.

Analyze the sender and subject of each email carefully. Output MUST be a valid JSON array of objects, with each object having exactly "uid" (number) and "category" (string). Do not add any explanation or markdown formatting.
Emails to classify:
${JSON.stringify(emails)}`;

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', errText);
      return NextResponse.json({ error: `Gemini API error: ${response.status}` }, { status: 502 });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      return NextResponse.json({ error: 'No classification response from AI.' }, { status: 502 });
    }

    return NextResponse.json({ classifications: JSON.parse(text) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'AI classification failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
