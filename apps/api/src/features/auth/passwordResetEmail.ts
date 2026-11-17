const escapeHtml = (value:string) => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')

export async function sendPasswordResetEmail(to:string,resetUrl:string,fetcher:typeof fetch=fetch):Promise<void>{
  const apiKey=process.env.BREVO_API_KEY,from=process.env.BREVO_FROM_EMAIL
  if(!apiKey||!from)throw new Error('Brevo email is not configured')
  const senderName=process.env.BREVO_SENDER_NAME||'FundiQuote'
  const response=await fetcher('https://api.brevo.com/v3/smtp/email',{
    method:'POST',
    headers:{'api-key':apiKey,'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({
      sender:{email:from,name:senderName},
      to:[{email:to}],
      subject:'Reset your FundiQuote password',
      textContent:`We received a request to reset your FundiQuote password. Use this link within 30 minutes: ${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      htmlContent:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17312b"><main style="max-width:560px;margin:24px auto;padding:28px;border:1px solid #dce7e1;border-radius:12px"><strong style="color:#237e65">${escapeHtml(senderName)}</strong><h1 style="font-size:21px">Reset your password</h1><p style="line-height:1.6">We received a request to reset your FundiQuote password. This link expires in 30 minutes.</p><p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#237e65;color:white;padding:12px 16px;border-radius:7px;text-decoration:none">Choose a new password</a></p><p style="font-size:12px;color:#687a71">If you did not request this, you can ignore this email.</p></main></body></html>`,
    }),
    signal:AbortSignal.timeout(15000),
  })
  if(!response.ok)throw new Error(`Brevo rejected password reset email (HTTP ${response.status})`)
}
